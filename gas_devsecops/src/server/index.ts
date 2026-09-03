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
