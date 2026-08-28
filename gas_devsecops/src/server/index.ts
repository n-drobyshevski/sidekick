// Bundle root: everything exported here lands on the GAS global `Server`
// (see esbuild.config.mjs and dist/entry.js).
export { doGet, include } from "./main";
export * as access from "./access";
export * as welcome from "./welcome";
export { setup } from "./setup";
export { deploymentDiagnostic } from "./diagnostics";
export * as api from "./api";
// `jobs`, not `scanJobs`: dev/gas-shims.js fires a continuation trigger by calling
// `window.Server.jobs.continueJob()`, so the namespace name is part of the harness contract
// rather than a preference. Renaming it makes a multi-hop scan stop after the first budget
// expiry and look exactly like a hang.
export * as jobs from "./scanJobs";
