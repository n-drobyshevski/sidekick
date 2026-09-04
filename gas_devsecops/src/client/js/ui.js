// The component base, as one import surface.
//
// ALMOST NONE OF IT IS THIS APP'S ANY MORE. The implementations moved to `gas_shared/ui/`
// when the design system was cut into its own package — the same 26 modules, byte for byte,
// now with one copy instead of three. This file is the app's end of that seam: it re-exports
// the shared barrel wholesale and adds the one module that is genuinely local.
//
// `projectScope.js` stays because it is not a component, it is this register's own answer to
// "which slice of the repository tree am I looking at" — it reads `src/domain/projectScope.ts`
// and it means nothing in a sibling that has no repositories. Everything else here would be
// a fork the moment it landed.
//
// Every call site keeps importing from "../ui.js"; esbuild flattens the re-export chain at
// build time, so the extra hop costs nothing at runtime. test/shared.test.js's parity
// contract holds `src/client/js/ui/` to exactly the local list above.

export * from "../../../../gas_shared/ui/index.js";
export {
  SUPPORT_GROUP_PREFIXES, isSupportGroup, projectKind, projectScopeControl, projectScopeView,
  scopeOptions,
} from "./ui/projectScope.js";
