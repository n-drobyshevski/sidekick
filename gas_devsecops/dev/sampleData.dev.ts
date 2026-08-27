// The dev harness aliases `./sampleData` here so a local run can carry a fuller dataset
// than the deployed bundle ships. There is no dataset in Phase 1 — there is no sync battery
// to seed from — so this is the empty shape, kept because the esbuild alias in serve.mjs
// resolves it on every dev build and removing one without the other breaks `npm run dev`.
export const SAMPLE_FINDINGS: unknown[] = [];
