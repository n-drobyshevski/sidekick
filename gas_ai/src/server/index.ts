// Bundle root: everything exported here lands on the GAS global `Server`
// (see esbuild.config.mjs and dist/entry.js).
export { doGet, include } from "./main";
export { setup } from "./setup";
export {
  wizDiagnostic, aarsDiagnostic, registerScopeDiagnostic, probeEdgeSteps,
  pinPostureBaseline, postureDelta,
} from "./diagnostics";
export * as api from "./api";
export * as jobs from "./syncJobs";
// Not an RPC: a warm takes minutes and answers nothing. Reached from the scheduled
// trigger handler in dist/entry.js, and from the tail of a sync.
export * as warm from "./warm";
