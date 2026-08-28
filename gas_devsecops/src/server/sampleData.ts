// The sample dataset the deployed bundle ships: none.
//
// `dev/serve.mjs` aliases `./sampleData` to `dev/sampleData.dev.ts` at dev-build time, so a
// local run gets a fuller dataset than production. This file is the production half and is
// deliberately empty — a deployed register must show what its tenant actually has, and a
// bundle carrying invented findings could put them on a leadership page.
//
// The alias was DEAD until this file existed: nothing under src/ imported "./sampleData", so
// esbuild's `^\./sampleData$` filter never matched anything. `sync.ts`'s caller importing it
// is what makes the dev seed reachable.

import type { Rec } from "../domain/util";

/** Raw API nodes per scope, in the shape each scope's query returns. */
export type SampleScan = Record<string, readonly Rec[]>;

/** Scans in order, each carrying the severity gate it applied. Empty in the deployed bundle. */
export const SAMPLE_SCANS: readonly {
  id: string;
  ts: string;
  nodes: SampleScan;
  gates: Record<string, readonly string[] | null>;
}[] = [];
