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
import { READ_TIME_EDGE_TYPES } from "../src/domain/reach";
import { bootServer } from "./gasEnv";
import type { Rec } from "../src/domain/util";

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

    // The edge census counts against the declared vocabulary MINUS the read-time folds, not
    // against whatever the ledger happens to hold. Both halves matter: a census that only ever
    // named what it found could never report a dead relationship type, which is the one thing
    // it exists to report; and a census that counted the six read-time types as missing would
    // print a shortfall on every healthy sync and teach a reader to discount the number.
    const persistable = EDGE_TYPES.length - READ_TIME_EDGE_TYPES.length;
    expect(out).toMatch(new RegExp(`populated edge types: +\\d+ of ${persistable} persistable`));
    expect(out).toContain(`${EDGE_TYPES.length} declared`);
    expect(out).toContain("A LIVE sync normalizes only five");

    // It must refuse to draw the conclusion. The whole design of this diagnostic is that
    // the histogram decides whether a degenerate distribution is a scope artefact or a
    // visibility finding, and a threshold picked in the code would pre-empt exactly that.
    expect(out).toContain("let the numbers decide");
    expect(out).not.toMatch(/\bthe register is (too )?(wide|wrong)\b/i);
  });

  it("counts a risk condition as signal, and not only an issue or a finding", async () => {
    const server = (await bootServer()) as Server;
    server.setup();
    server.api.runSync({});

    // The regression this pins: cells are plain text and hold the STRING "true", so the
    // original `r["sensitive_data"] === true` could not fire on any row this app has ever
    // written. The diagnostic reported the seed as 21 of 87 carrying signal; reading the
    // ledger through its own decoder makes it 42. A register full of risk conditions read as
    // a register with none, which is the exact false-negative this diagnostic exists to catch.
    const out = server.registerScopeDiagnostic();
    const signal = /carrying any signal: +(\d+) of (\d+)/.exec(out);
    expect(signal, "the signal line must be present").toBeTruthy();
    const withSignal = Number(signal![1]);

    // Assets carrying an unresolved issue or an open failing finding — everything the
    // predicate would count if the condition half were dead again. Read off the API rather
    // than restated, so the bound moves with the seed instead of being a magic number.
    const problems = server.api.getProblems({ all: true }) as { ok: boolean; data: Rec };
    expect(problems.ok).toBe(true);
    const carriers = new Set(
      ((problems.data["rows"] ?? []) as Rec[]).map((r) => String(r["assetId"] ?? "")),
    );
    carriers.delete("");

    expect(withSignal).toBeGreaterThan(carriers.size);
  });
});
