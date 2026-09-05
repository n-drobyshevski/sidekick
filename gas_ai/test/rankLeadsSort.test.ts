// The knob has to move something, and the signature has to say that it did.
//
// "A flag that does nothing produces a run that looks like it measured something" — the same
// failure the probe's unrecognised-argument refusal exists to stop, at a different grain.
// `rank_leads_sort` ships OFF, which is the iron rule and is exactly what makes it easy for
// the flag to be silently inert: every pinned expectation in the suite is taken at the
// default, so a `compareProblemsBy` that ignored its argument, a `problemsModel` that never
// read the setting, or a `setRankRule` that wrote a key nothing consults would all leave the
// whole battery green. The register would then ship a control an operator can turn on, and
// watch nothing happen.
//
// So this asserts BOTH directions against the live endpoint: off is byte-identical order,
// on is a genuine reordering of the SAME population under a DIFFERENT signature. The second
// half is the one that cannot be faked by leaving the code out.

import { beforeAll, describe, expect, it } from "vitest";
import { bootServer, teardownServer } from "./gasEnv";

type Server = Awaited<ReturnType<typeof bootServer>>;

interface ProblemsPayload {
  rows: Array<{ id: string; rankScore?: number; rankReasons?: string[] }>;
  rankSignature: string;
  rankLeadsSort: boolean;
}

function problems(server: Server): ProblemsPayload {
  const res = server.api.getProblems({}) as { ok: boolean; error?: string; data: ProblemsPayload };
  if (!res.ok) throw new Error("getProblems failed: " + res.error);
  return res.data;
}

describe("rank_leads_sort", () => {
  let server: Server;
  let atDefault: ProblemsPayload;

  beforeAll(async () => {
    server = await bootServer();
    server.setup();
    const res = server.api.runSync({}) as { ok: boolean; error?: string };
    if (!res.ok) throw new Error("seed sync failed: " + res.error);
    atDefault = problems(server);
  });

  it("is off at the shipped default, and every row is still scored", () => {
    expect(atDefault.rankLeadsSort).toBe(false);
    // The score rides along even when it does not lead the order — that is what makes the
    // flip measurable at all, and what the evaluation harness reads.
    expect(atDefault.rows.length).toBeGreaterThan(10);
    for (const row of atDefault.rows) {
      expect(typeof row.rankScore, row.id).toBe("number");
      // A number a reader cannot interrogate is the failure mode this field answers.
      expect((row.rankReasons ?? []).length, row.id).toBeGreaterThan(0);
    }
  });

  it("names only the terms it actually reads, at the default's two-term shares", () => {
    // `rankSignature` is in by PRESENCE for the shares: a term at share 0 is not read, so it
    // does not appear. The default zeroes exploitation and adjacency.
    expect(atDefault.rankSignature).toContain("terms=rule,time");
    expect(atDefault.rankSignature).toContain("time=dueAtOnly");
  });

  it("turning it on reorders THE SAME rows under a different signature", () => {
    const saved = server.api.setRankRule({
      rule: {
        shares: { rule: 0.25, time: 0.3, exploitation: 0.3, adjacency: 0.15 },
        timeSource: "dueAtElseAge",
      },
      leadsSort: true,
    }) as { ok: boolean; error?: string; data: { leadsSort: boolean; signature: string } };
    expect(saved.ok, saved.error).toBe(true);
    expect(saved.data.leadsSort).toBe(true);

    const led = problems(server);
    expect(led.rankLeadsSort).toBe(true);
    // The population is untouched — this is a reordering, never a filter. Sorted-id equality
    // is what says so; a knob that quietly dropped rows would otherwise read as a reorder.
    expect([...led.rows.map((r) => r.id)].sort()).toEqual([...atDefault.rows.map((r) => r.id)].sort());
    expect(led.rows.map((r) => r.id)).not.toEqual(atDefault.rows.map((r) => r.id));
    // A DERIVATION change, so the signature must move with it: the clock source and the two
    // extra terms all decide WHICH READING a row gets, not merely what it is worth.
    expect(led.rankSignature).not.toBe(atDefault.rankSignature);
    expect(led.rankSignature).toContain("terms=rule,time,exploitation,adjacency");
    expect(led.rankSignature).toContain("time=dueAtElseAge");

    // Descending, unscored last — the comparator's level 0, checked on the wire rather than
    // only in the unit test, because this is the order a reader is actually handed.
    const scores = led.rows.map((r) => (typeof r.rankScore === "number" ? r.rankScore : -1));
    for (let i = 1; i < scores.length; i++) expect(scores[i]!).toBeLessThanOrEqual(scores[i - 1]!);
  });

  it("setRankRule is a PATCH — leadsSort survives a later rule-only save", () => {
    // Two tabs of one Settings form saving a minute apart must not revert each other, and
    // the flag is the field most likely to be absent from a save that is about the shares.
    const res = server.api.setRankRule({ rule: { defaultRuleWeight: 0.6 } }) as {
      ok: boolean; data: { leadsSort: boolean; rule: { defaultRuleWeight: number } };
    };
    expect(res.ok).toBe(true);
    expect(res.data.rule.defaultRuleWeight).toBe(0.6);
    expect(res.data.leadsSort).toBe(true);
    teardownServer();
  });
});
