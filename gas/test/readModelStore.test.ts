// The durable second level under the read-model cache, and the four invariants that make it
// safe rather than merely faster.
//
// CacheService caps TTLs at six hours, so a daily-scan tenant goes cold three or four times
// between scans and recomputes a byte-identical answer each time. This store keeps that answer
// on Drive. What makes it correct is not the caching — it is the boundaries: only time-invariant
// models go in, only the warm may write, every file is overwritten rather than accumulated, and
// every Drive failure degrades to a plain recompute.
//
// The failure this file mostly guards is silent. A drifted params hash, a sweep with the wrong
// keep-list or a missing envelope all produce correct-looking pages that are simply slower — or,
// worse, a sweep that deletes live entries and rewrites them forever.

import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory Drive: name -> parsed payload, plus call counters.
const files = new Map<string, unknown>();
// `folder` counts FOLDER RESOLUTIONS — getFolderById + getFoldersByName in the real
// archiveStore, which is the pair the memo below exists to stop paying per model.
const calls = { create: 0, read: 0, trash: 0, list: 0, folder: 0 };
let driveThrows = false;

vi.mock("../src/server/archiveStore", () => ({
  // The write-side lookup: it creates, and it throws when Drive is unreachable.
  subfolder: () => {
    calls.folder += 1;
    if (driveThrows) throw new Error("drive unavailable");
    return { __fake: true };
  },
  // The read-side lookup: total, never creates, null when the folder is absent or Drive threw.
  findSubfolder: () => {
    calls.folder += 1;
    return driveThrows ? null : { __fake: true };
  },
  readGzJsonIn: (_folder: unknown, name: string) => {
    calls.read += 1;
    return files.has(name) ? files.get(name) : null;
  },
  writeGzJson: (_folder: unknown, name: string, payload: unknown) => {
    calls.create += 1;
    if (driveThrows) throw new Error("drive unavailable");
    files.set(name, JSON.parse(JSON.stringify(payload)));
    return { getId: () => name };
  },
  listNames: () => { calls.list += 1; return [...files.keys()]; },
  trashNamed: (_f: string, name: string) => { calls.trash += 1; files.delete(name); },
}));

let stamp = "build1.100.tagA";
// A REAL L1, not a pass-through. It was a pass-through, and that is exactly why these specs
// missed the worst bug in this file: `cached()` skips its callback on a hit, so anything
// recorded inside that callback is not recorded on a warm where L1 is already warm — which is
// the common case for a 4-hourly trigger against a 6-hour TTL. The sweep then deleted every
// durable file. A fake that can hit is the only kind that could have caught it.
const l1 = new Map<string, unknown>();
vi.mock("../src/server/serverCache", () => ({
  cached: (n: string, p: unknown, compute: () => unknown) => {
    const k = n + JSON.stringify(p ?? null) + stamp;
    if (l1.has(k)) return l1.get(k);
    const v = compute();
    l1.set(k, v);
    return v;
  },
  peekCached: (n: string, p: unknown) => l1.get(n + JSON.stringify(p ?? null) + stamp),
  primeCached: (n: string, p: unknown, v: unknown) => { l1.set(n + JSON.stringify(p ?? null) + stamp, v); },
  currentStamp: () => stamp,
  paramsHash: (p: unknown) => "h" + JSON.stringify(p ?? null).length,
}));

// Re-imported per test: `disabled` and `touched` are module state that lives for one GAS
// execution, which is correct in production and would leak between specs here.
const load = () => import("../src/server/readModelStore");
let durablyCached: Awaited<ReturnType<typeof load>>["durablyCached"];
let durablyPeek: Awaited<ReturnType<typeof load>>["durablyPeek"];
let duringWarm: Awaited<ReturnType<typeof load>>["duringWarm"];
let readModelFileName: Awaited<ReturnType<typeof load>>["readModelFileName"];
let sweepReadModels: Awaited<ReturnType<typeof load>>["sweepReadModels"];

beforeEach(async () => {
  vi.resetModules();
  ({ durablyCached, durablyPeek, duringWarm, readModelFileName, sweepReadModels } = await load());
  files.clear();
  l1.clear();
  calls.create = 0; calls.read = 0; calls.trash = 0; calls.list = 0; calls.folder = 0;
  driveThrows = false;
  stamp = "build1.100.tagA";
  vi.stubGlobal("console", { ...console, warn: () => {} });
});

const P = { domain: "", severities: null };

describe("the read path: L2 hit means no recompute", () => {
  it("serves a stored value whose stamp matches, without computing", () => {
    duringWarm(() => durablyCached("m", P, () => "first"));
    const compute = vi.fn(() => "second");
    expect(durablyCached("m", P, compute)).toBe("first");
    expect(compute).not.toHaveBeenCalled();
  });

  it("recomputes when the stamp has moved on", () => {
    duringWarm(() => durablyCached("m", P, () => "old"));
    stamp = "build1.101.tagA"; // a scan landed
    expect(durablyCached("m", P, () => "new")).toBe("new");
  });

  // The stamp's first segment is serverCache.CACHE_EPOCH (it was BUILD_ID, which made every
  // deploy a cold start). Bumping the epoch must still retire every durable file at once.
  it("treats a cache-epoch bump the same as a data change", () => {
    duringWarm(() => durablyCached("m", P, () => "old"));
    stamp = "build2.100.tagA";
    expect(durablyCached("m", P, () => "new")).toBe("new");
  });

  // readGzJsonNamed returns null for an unreadable file too, so without the envelope a
  // legitimately-null payload would be indistinguishable from a failure and recompute forever.
  it("round-trips a null payload as a hit, not a miss", () => {
    duringWarm(() => durablyCached("m", P, () => null));
    const compute = vi.fn(() => "recomputed");
    expect(durablyCached("m", P, compute)).toBeNull();
    expect(compute).not.toHaveBeenCalled();
  });
});

describe("the write path: only the warm may write", () => {
  // If arbitrary reads minted files the key space becomes names x domains x support groups x
  // severity scopes, and a file for a renamed domain is orphaned permanently — the sweep cannot
  // tell it from a legitimately cold scoped entry.
  it("writes nothing on a miss outside the warm", () => {
    expect(durablyCached("m", P, () => "value")).toBe("value");
    expect(files.size).toBe(0);
    expect(calls.create).toBe(0);
  });

  it("writes one file on a miss inside the warm", () => {
    duringWarm(() => durablyCached("m", P, () => "value"));
    expect([...files.keys()]).toEqual([readModelFileName("m", P)]);
  });

  // writeGzJson trashes and recreates, so an unconditional write would churn a set of files
  // into Drive Trash on every fire of a 4-hourly trigger — and trashing frees no quota.
  it("does not rewrite when a re-warm finds the stamp unchanged", () => {
    duringWarm(() => durablyCached("m", P, () => "value"));
    expect(calls.create).toBe(1);
    duringWarm(() => durablyCached("m", P, () => "value"));
    expect(calls.create).toBe(1);
  });

  it("overwrites in place when the stamp moved — one file, not two", () => {
    duringWarm(() => durablyCached("m", P, () => "old"));
    stamp = "build1.101.tagA";
    duringWarm(() => durablyCached("m", P, () => "new"));
    expect(files.size).toBe(1);
    expect(durablyCached("m", P, () => "unused")).toBe("new");
  });
});

describe("the sweep: bounded file count across namespace bumps", () => {
  // The deterministic-name scheme alone does NOT bound garbage. This repo bumps read-model
  // namespaces whenever a payload shape changes, and nothing will ever ask for the old name
  // again to overwrite it.
  it("trashes a leftover from a previous namespace and keeps the current one", () => {
    files.set("rm-mttrTrend5-hXX.json.gz", { v: 1, stamp, name: "mttrTrend5", value: 1 });
    duringWarm(() => {
      durablyCached("mttrTrend6", P, () => "v");
      sweepReadModels();
    });
    expect([...files.keys()]).toEqual([readModelFileName("mttrTrend6", P)]);
  });

  // The keep-list is what the warm touched, never a restatement of the call sites' params — a
  // drifted restatement would trash live entries and rewrite them every single pass.
  it("keeps every entry the warm touched, including ones that only hit", () => {
    duringWarm(() => { durablyCached("a", P, () => 1); durablyCached("b", P, () => 2); });
    expect(files.size).toBe(2);
    duringWarm(() => {
      durablyCached("a", P, () => 1); // hits, writes nothing
      durablyCached("b", P, () => 2);
      sweepReadModels();
    });
    expect(files.size).toBe(2);
  });

  it("refuses to sweep when no warm ran in this execution", () => {
    files.set("rm-x-h1.json.gz", { v: 1, stamp, name: "x", value: 1 });
    sweepReadModels();
    expect(files.size).toBe(1);
  });
});

describe("failure semantics: an optimization, never a correctness dependency", () => {
  it("returns the computed value when Drive is unreachable", () => {
    driveThrows = true;
    expect(durablyCached("m", P, () => "computed")).toBe("computed");
  });

  // A missing ARCHIVE_FOLDER_ID or a revoked scope should cost ONE failed call, not one per
  // durable read-model per request. The memo is what bounds it now: the folder resolves to null
  // once and every later read answers off that, without reaching Drive at all.
  it("stops trying after the first Drive failure in an execution", () => {
    driveThrows = true;
    for (const n of ["a", "b", "c", "d"]) durablyCached(n, P, () => n);
    expect(calls.folder).toBe(1);
    expect(calls.read).toBe(0);
  });
});

describe("the folder is resolved once per execution, not once per model", () => {
  // THE READ HALF USED TO SKIP THE MEMO. `readGzJsonNamed` resolved the folder afresh — a
  // getFolderById plus a getFoldersByName — on every durable read, so a page reading three
  // durable models paid six Drive calls for one folder. Invisible except as latency, which is
  // the one symptom a register inside a six-minute execution cap can least afford.
  it("pays one folder resolution across three durable reads", () => {
    duringWarm(() => {
      durablyCached("a", P, () => 1);
      durablyCached("b", P, () => 2);
      durablyCached("c", P, () => 3);
    });
    l1.clear();
    calls.folder = 0;
    durablyCached("a", P, () => 1);
    durablyCached("b", P, () => 2);
    durablyCached("c", P, () => 3);
    expect(calls.read).toBe(6); // three writes' reads, then three hits
    expect(calls.folder).toBe(0); // memoized by the warm above, in this same execution
  });

  it("resolves it exactly once when the execution starts cold", () => {
    durablyCached("a", P, () => 1);
    durablyCached("b", P, () => 2);
    durablyCached("c", P, () => 3);
    expect(calls.folder).toBe(1);
  });
});

describe("an envelope too big for one file is skipped, not written", () => {
  // A read-model that serializes past the cap is a whole-register payload; writing it would cost
  // more than recomputing it, and a write big enough to blow the execution cap would take the
  // REST of the warm down with it. Skipping ONE entry degrades instead — and the run's other
  // durable writes must still happen, which is why this is not the `disabled` breaker.
  const big = () => ({ rows: ["x".repeat(4_000_001)] });

  it("writes no file for an oversized value", () => {
    duringWarm(() => durablyCached("huge", P, big));
    expect(files.size).toBe(0);
    expect(calls.create).toBe(0);
  });

  it("keeps writing the other models in the same warm", () => {
    duringWarm(() => {
      durablyCached("huge", P, big);
      durablyCached("small", P, () => "ok");
    });
    expect([...files.keys()]).toEqual([readModelFileName("small", P)]);
  });

  it("still answers with the computed value", () => {
    let out: unknown;
    duringWarm(() => { out = durablyCached("huge", P, big); });
    expect((out as { rows: string[] }).rows[0]!.length).toBe(4_000_001);
  });
});

describe("the filename derives from the same hash as the L1 key", () => {
  // A drift here means the L2 never hits: no error, no wrong answer, a feature quietly doing
  // nothing. This is the only assertion that would catch it.
  it("names the file from paramsHash(params)", () => {
    expect(readModelFileName("mttrTrend6", P)).toBe(`rm-mttrTrend6-h${JSON.stringify(P).length}.json.gz`);
  });

  it("distinguishes different params and shares one name for identical params", () => {
    expect(readModelFileName("m", { a: 1 })).toBe(readModelFileName("m", { a: 1 }));
    expect(readModelFileName("m", { a: 1 })).not.toBe(readModelFileName("m", { ab: 12 }));
  });
});


describe("the sweep survives a warm that only hits L1", () => {
  // The regression that shipped past a pass-through mock: with a 4-hourly trigger and a 6-hour
  // TTL, most warms find L1 warm and never reach the L2 layer at all. If the keep-list is only
  // built inside that callback it comes back empty and the sweep deletes everything.
  it("keeps the durable files when the second warm is served entirely from L1", () => {
    duringWarm(() => { durablyCached("a", P, () => 1); durablyCached("b", P, () => 2); });
    expect(files.size).toBe(2);
    duringWarm(() => {
      durablyCached("a", P, () => 1); // L1 hit — compute callback never runs
      durablyCached("b", P, () => 2);
      sweepReadModels();
    });
    expect(files.size).toBe(2);
  });
});

// doGet's inline bootstrap peeks rather than reads through: a cold core computed inside doGet
// held the whole page for ~20 s after a deploy. The peek must answer from what is stored and
// never compute, and an L2 hit must land in L1 exactly as the read-through would have put it.
describe("durablyPeek: stored or nothing, never computed", () => {
  it("answers undefined when neither level holds the entry", () => {
    expect(durablyPeek("m", P)).toBeUndefined();
    expect(files.size).toBe(0);
  });

  it("answers from L1 without touching Drive", () => {
    durablyCached("m", P, () => "value");
    calls.read = 0;
    expect(durablyPeek("m", P)).toBe("value");
    expect(calls.read).toBe(0);
  });

  it("answers from the durable file and promotes it to L1", () => {
    duringWarm(() => durablyCached("m", P, () => "warmed"));
    l1.clear(); // CacheService lapsed; the Drive file survives
    expect(durablyPeek("m", P)).toBe("warmed");
    const compute = vi.fn(() => "recomputed");
    calls.read = 0;
    expect(durablyCached("m", P, compute)).toBe("warmed");
    expect(compute).not.toHaveBeenCalled();
    expect(calls.read).toBe(0); // the promotion is what the read-through then hits
  });

  it("treats a durable file from another build as cold", () => {
    duringWarm(() => durablyCached("m", P, () => "old"));
    l1.clear();
    stamp = "build2.100.tagA"; // a deploy
    expect(durablyPeek("m", P)).toBeUndefined();
  });
});
