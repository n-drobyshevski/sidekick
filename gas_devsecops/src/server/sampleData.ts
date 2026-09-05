// The production stub for the dev harness's sample dataset — and this file MUST STAY EMPTY.
//
// WHAT THIS FILE IS FOR. It is a seam, not a dataset. `dev/serve.mjs`'s esbuild alias
// (`dev-sample-data` plugin, `buildDevServer`) rewrites the specifier `./sampleData`, as
// resolved from `src/server/`, to `dev/sampleData.dev.ts` on every dev build — so anything
// under `src/server` that imports `./sampleData` gets the realistic dev dataset in the
// browser bundle, and gets THIS file, unchanged, in every other build. There is no bundler
// flag or environment check involved: the alias is the only fork in the road, which is what
// makes it safe — a deployed build is never one dropped `if (dev)` away from shipping
// fabricated findings.
//
// WHY IT SHIPS EMPTY ON PURPOSE. `scanJobs.ts`'s own header already draws this line: "this
// project ships no sample data, and inventing one would put fabricated findings in a security
// register." A register that reports vulnerability counts, MTTR and SLA burn has exactly one
// way to be trustworthy about an empty tenant, a fresh install, or a sync that has not run
// yet — by actually reporting empty, rather than quietly falling back to a dressed-up demo.
// A register that CAN fabricate findings cannot be trusted to say it has none. So this file's
// only job is to make that impossible: every export below is present so `devSeed.ts` type-
// checks and runs unconditionally in both builds, and every one of them is empty or zero, so
// `devSeed.seedSampleLedger()` writes nothing when it runs against this file.
//
// SHAPE. Mirrors `dev/sampleData.dev.ts`'s export names and types exactly — same names, same
// types, only the population differs — because that mirror is what lets `devSeed.ts` (and
// anything else under `src/server`) import `./sampleData` once and be correct in both worlds
// without a single conditional. `test/sampleData.test.ts` pins the dev file's population;
// `test/devSeed.test.ts` pins that THIS file's arrays are empty — literally, as text — so a
// well-meaning paste of sample data into the production seam is caught before it ships.

import type { Scope } from "../domain/config";
import type { Rec } from "../domain/util";

export const SAMPLE_FINDINGS: unknown[] = [];

export const SAMPLE_RAW_NODES: Record<Scope, Rec[]> = {
  sca: [],
  sast: [],
  secrets: [],
};

export const SAMPLE_COUNTS = {
  sca: 0,
  sast: 0,
  secrets: 0,
  secretsSingles: 0,
  secretsTwinPairs: 0,
} as const;

/** One scope's step of a synthetic sync battery. Kept identical to the dev file's shape. */
export interface SampleScopeBattery {
  scope: Scope;
  rawRecords: Rec[];
  mode: string;
  scannedSeverities: string[] | null;
}

export interface SampleSync {
  syncId: string;
  scopes: SampleScopeBattery[];
}

/** No syncs in a production build — nothing for devSeed.seedSampleLedger() to persist. */
export const SAMPLE_SYNCS: readonly SampleSync[] = [];
