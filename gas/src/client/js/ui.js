// The component base, as one import surface.
//
// ALMOST NONE OF IT IS THIS APP'S ANY MORE. `el`, `clear`, the severity badge, the KPI tile,
// the pager, the sheet, the settings form, the toast, the dialog, the skeleton and the empty
// state were 1,070 lines of this file; they are `gas_shared/ui/` now, one copy for four
// surfaces instead of three copies that had already drifted. This file is the app's end of
// that seam: it re-exports the shared barrel wholesale and adds the modules that are
// genuinely this register's.
//
// WHAT STAYS, AND WHY EACH ONE IS NOT A FORK:
//
//   changeChip.js  a delta that knows which DIRECTION is worse. `invert` is a claim about a
//                  risk metric, not about a number.
//   span.js        `fmtSpan` — hours/days/months/years on one scale. It is not `fmtDays` and
//                  not `days1`; see the module header for the table of what the three do to
//                  the same input, and why renaming it was the honest move.
//   nvd.js         a CVE's page at NIST. No sibling register has a CVE.
//   scopeBar.js    WHICH two scopes this register has (a Wiz/Domain tag, a support group).
//                  The chips themselves are the shared `filterChipRow` now.
//   splitBar.js    an in/out proportion with arbitrary tones. `sevSegmentBar` draws
//                  severities and only severities.
//   usageMeter.js  the Google Sheet's ten-million-cell ceiling — a fact about this app's
//                  store, which no sibling has.
//   combobox.js    NOT ONE OF THE ABOVE. It is a genuine fork, blocked on two glyphs the
//                  shared icon set does not hold; the file's header names the exact
//                  gas_shared change that retires it. On the parity allow-list under protest.
//
// Every call site keeps importing from "../ui.js"; esbuild flattens the re-export chain at
// build time, so the extra hop costs nothing at runtime. test/shared.test.js's parity
// contract holds `src/client/js/ui/` to exactly the list above.
//
// `filterCombobox` is deliberately re-exported AFTER the star: an explicit export shadows the
// same name coming through `export *`, which is what keeps the local one in force until the
// glyphs land.

export * from "../../../../gas_shared/ui/index.js";

export { changeChip } from "./ui/changeChip.js";
export { closeCombobox, filterCombobox } from "./ui/combobox.js";
export { nvdUrl } from "./ui/nvd.js";
export { scopeBar } from "./ui/scopeBar.js";
export { fmtSpan } from "./ui/span.js";
export { splitBar } from "./ui/splitBar.js";
export { usageMeter } from "./ui/usageMeter.js";
