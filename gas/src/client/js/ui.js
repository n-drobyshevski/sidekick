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
//
// `usageMeter.js` HAS LEFT THIS LIST TOO, and the reason it was on it was measurably wrong.
// Its entry read "a fact about this app's store, which no sibling has"; gas_devsecops's
// `readModels.ts` publishes `cellLimit: 10_000_000` and its Data page computes the same ratio
// off it. What was gas-only was the WIDGET — a used/total numeral caption plus warn/bad
// thresholds, which neither `meter()` nor `progressBar()` carries — and a widget is exactly
// what the design system is for. It is `gas_shared/ui/usageMeter.js` now and arrives through
// the star below; `capacity.js` never changed its import.
// `combobox.js` IS GONE, AND THE TWO GLYPHS ARE WHY IT COULD BE. It was a genuine fork,
// blocked on `users` and `noTag` — two names `scopeSwitch.js` supplied that the shared icon
// set did not hold, where `uiIcon()` falls back to a 1px dot SILENTLY. Both are in
// `gas_shared/ui/uiIcons.js` now, an unknown name is loud rather than silent, and the one
// feature the fork had that the shared file did not — `closeCombobox()`, a global "dismiss
// whatever is open" for a hashchange with no click behind it — was ported INTO shared rather
// than kept here. `filterCombobox` and `closeCombobox` now come through the star below, and
// the explicit re-export that used to shadow them is deleted with the file.
//
// Every call site keeps importing from "../ui.js"; esbuild flattens the re-export chain at
// build time, so the extra hop costs nothing at runtime. test/shared.test.js's parity
// contract holds `src/client/js/ui/` to exactly the list above.

export * from "../../../../gas_shared/ui/index.js";

export { changeChip } from "./ui/changeChip.js";
export { nvdUrl } from "./ui/nvd.js";
export { scopeBar } from "./ui/scopeBar.js";
export { fmtSpan } from "./ui/span.js";
export { splitBar } from "./ui/splitBar.js";
