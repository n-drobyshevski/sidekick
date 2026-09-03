// Bundle root: everything exported here lands on the GAS global `Server`
// (see esbuild.config.mjs and dist/entry.js).
export { doGet, include } from "./main";
export * as access from "./access";
export * as welcome from "./welcome";
export { setup } from "./setup";
export { deploymentDiagnostic } from "./diagnostics";
export * as api from "./api";
// The trigger handlers in dist/entry.js reach for these two namespaces directly rather than
// through `api`, because a trigger is not an RPC: it takes no params, returns nothing a client
// reads, and must NOT pass through the access gate `timedApi_` applies. Exporting the modules
// is what makes `trigger_continueSync` / `trigger_watchdogSync` / `trigger_dailySync` /
// `trigger_warmReadModels` resolvable on the GAS global.
export * as scanJobs from "./scanJobs";
export * as readModels from "./readModels";
// The dev harness calls `Server.devSeed.seedSampleLedger()` from `dev/boot.js` to feed
// `dev/sampleData.dev.ts`'s battery through the real slimRecord -> persistSync pipeline (see
// `devSeed.ts`'s header). In a deployed build this is a documented no-op: `devSeed.ts`'s
// `./sampleData` import resolves to `src/server/sampleData.ts`, which ships every array empty
// on purpose, so `seedSampleLedger()` writes nothing — exporting it here does not put sample
// data on the production Server global, only a function that refuses to seed one that has any.
export * as devSeed from "./devSeed";
