// Boots the whole server against the dev harness's GAS fakes, in-process.
//
// `dev/gas-shims.js` already fakes every Google service the server touches, for the local
// dev server. It is plain JS assigning to `window`, with no DOM dependency, so aliasing
// `window` to `globalThis` and evaluating it gives Node the same environment the browser
// harness gets — which means a test can run `setup()`, a full dry-run sync, and every
// `api_*` handler end to end. That is the only way to exercise api.ts, syncJobs.ts and
// wizClientAi.ts at all: they have no other test coverage.
//
// Using the dev shims rather than a second set of fakes is deliberate. A private mock would
// be one more thing to keep in step with the real services; this way the test and the dev
// server describe the same environment, and a shim that drifts breaks both at once.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import { vi } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Frozen so sync ids, timestamps and elapsed figures are stable across runs. */
export const FROZEN_NOW = new Date("2026-08-13T09:00:00.000Z");

type ServerModule = typeof import("../src/server/index");

/**
 * Fresh GAS environment + a freshly-imported server.
 *
 * Every call resets the module registry, so the memoized spreadsheet handle in sheetsDb
 * and the read memos in syncStore start empty — which is what lets one test run two
 * independent syncs and compare them.
 *
 * Only `Date` is faked. `setTimeout` stays real because the trigger shim uses it to fire
 * continuation jobs; and a frozen clock means the hop deadline in syncJobs never trips, so
 * a dry-run sync completes in a single hop and the output does not depend on machine speed.
 */
export async function bootServer(): Promise<ServerModule> {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FROZEN_NOW);

  const g = globalThis as Record<string, unknown>;
  g["window"] = globalThis;
  runInThisContext(readFileSync(join(ROOT, "dev/gas-shims.js"), "utf8"), {
    filename: "dev/gas-shims.js",
  });

  return (await import("../src/server/index")) as ServerModule;
}

/** Undo the clock freeze; the shims' state dies with the module registry on the next boot. */
export function teardownServer(): void {
  vi.useRealTimers();
}

/**
 * The `api_*` surface, as `dist/entry.js` exposes it to `google.script.run`.
 *
 * Read-only handlers only: the mutating ones (runSync, setSettings, setAarsRule,
 * rescoreAars, resetData) change state and are driven explicitly by the tests that want
 * them, not swept over.
 */
export const READ_APIS: Array<[name: string, params: unknown, label?: string]> = [
  ["bootstrap", {}],
  ["getGraph", {}],
  // Bare, then asked for one kind's value lists. The two shapes differ on purpose — every
  // kind's lists together were 22 KB of a 28 KB payload, so `valuesFor` is filled only for
  // the kind the palette is actually about, and the bare answer must stay empty of them.
  ["getQueryVocabulary", {}, "getQueryVocabulary (bare)"],
  ["getQueryVocabulary", { kind: "AI_AGENT" }, "getQueryVocabulary (values for AI Agent)"],
  // The default lens, and then the screenshot's query. The second is the one that proves a row
  // is a PATH rather than an entity, so the golden carries both shapes. They need distinct
  // LABELS: the snapshot is keyed by test name, and two cases called `runGraphQuery` would
  // write to one key and silently record only the last.
  ["runGraphQuery", {}, "runGraphQuery (default lens)"],
  [
    "runGraphQuery",
    { query: { kind: "AI_AGENT", steps: [{ edge: "RUNS_AS", node: { kind: "SERVICE_ACCOUNT" } }] } },
    "runGraphQuery (agent runs as service account)",
  ],
  ["getAssets", {}],
  ["getAssetOptions", {}],
  ["getIssues", {}],
  ["getToxicCombos", {}],
  ["getSyncHistory", {}],
  ["getSettings", {}],
  ["getAarsRule", {}],
  // Phase 5: the problem tree's rule state, mirroring getAarsRule above. Mutating
  // endpoints (setProblemRule, previewProblemRule, recomputeProblems) stay out of this
  // list, per its own rule.
  ["getProblemRule", {}],
  // Phase 6: the posture lattice's rule state, mirroring getProblemRule above. Mutating
  // endpoints (setPostureRule, previewPostureRule, recomputePostures) stay out of this
  // list, per its own rule.
  ["getPostureRule", {}],
  ["getStorageStats", {}],
  // agent-h-chatbot is the max-degree node in the golden getGraph payload (17 neighbors),
  // so it exercises the widest neighbour list getAssetDetail can produce in this estate.
  ["getAssetDetail", { id: "agent-h-chatbot" }],
  // One of agent-h-chatbot's own issues, so the two new golden cases are cross-checkable
  // against each other as well as against the dry-run sync snapshot.
  ["getIssueDetail", { id: "iss-026" }],
  ["getConfigFindings", {}],
  // cfg-005 is the off-inventory case on purpose: a RAW_ACCESS_POLICY the AI graph does
  // not model, carrying an ignore rule. It pins both the null `asset` arm and the
  // accepted-risk arm, which the linked findings would not reach.
  ["getConfigFindingDetail", { id: "cfg-005" }],
];

/**
 * Replace the values that legitimately vary between runs, so a diff in the snapshot means
 * a behaviour change rather than a clock tick. Volatile fields are REPLACED, not dropped —
 * a field that stops being emitted has to show up as a difference.
 */
export function normalize(value: unknown): unknown {
  const VOLATILE = /^(dataVersion|elapsedMs|ms|durationMs)$/;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = VOLATILE.test(k) ? `<${k}>` : walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(value);
}
