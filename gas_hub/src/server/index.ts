// Bundle root: everything exported here lands on the GAS global `Server`
// (see esbuild.config.mjs and dist/entry.js).
//
// THREE EXPORTS, AND THE ABSENCES ARE THE DESIGN. The registers additionally export
// `welcome`, `setup`, `deploymentDiagnostic`, `scanJobs`, `readModels` and `devSeed`; this
// app has no entry gate (see dist/entry.js's doGet), no spreadsheet or folder to provision,
// no trigger to resolve a handler for, and no sample data to seed. An export here is what
// makes a name resolvable on the GAS global, so exporting one this app does not implement
// would be a global that throws at call time rather than a missing one that never gets
// called.
export { doGet, include } from "./main";
export * as access from "./access";
export * as api from "./api";
