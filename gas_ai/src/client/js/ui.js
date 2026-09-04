// The component base, as one import surface.
//
// ALMOST NONE OF IT IS THIS APP'S ANY MORE. Twenty-three modules moved to `gas_shared/ui/`
// when the design system was cut into its own package — one copy for the three sidekicks
// instead of three that drift. This file is the app's end of that seam: it re-exports the
// shared barrel wholesale and adds the ten modules that are genuinely this register's.
//
// WHAT STAYED, AND WHY. Every one of them reads something no sibling has: the decision
// lattice and its icicle, the ACT/ATTEND/TRACK outcome badge, the Tier 1..4 posture badge,
// the cascade's claim rail and its "is this rule quietly failing" diagnostic list, the Data
// page's prune panel, the AARS chip, and this register's project-scope switcher (which
// reads `src/domain/` and means nothing in a sibling with no asset graph). A component that
// draws an AARS band is not a component the yellow register can use.
//
//   aarsChip.js       the AARS score as a chip, in the shared severity palette
//   outcome.js        the problem tree's ACT/ATTEND/TRACK*/TRACK badge
//   posture.js        the posture lattice's Tier 1..4 badge
//   lattice.js        the decision lattice: 54 leaves or 27 cells as a grid
//   latticeIcicle.js  the same lattice as nested area, for the shape rather than the cells
//   latticeSection.js the two together, with the controls that switch between them
//   claimRail.js      how much of a closed space one cascade row claims, on a shared axis
//   diagList.js       the "is this rule quietly failing" read-out, shared by all three cascades
//   prunePanel.js     the Data page's keep-one-project-delete-the-rest control
//   projectScope.js   this register's own answer to "which slice am I looking at"
//
// ONE NAME IS DELIBERATELY SHADOWED. `registerWideNote` exists in both: `gas_shared/ui/dom.js`
// exports the plain DOM builder `(text, opts)`, and this app's `projectScope.js` exports a
// scope-AWARE `(bootstrapData, detail)` that reads the live scope and returns null when the
// view is not narrowed. The explicit re-export below wins over `export *` — that is the ES
// module rule, not an accident of order — so gas_ai's four call sites (aars, data, scans)
// keep the wrapper they were written against. Do not "fix" this by dropping the line.
//
// Every call site keeps importing from "../ui.js"; esbuild flattens the re-export chain at
// build time, so the extra hop costs nothing at runtime. test/shared.test.js's parity
// contract holds `src/client/js/ui/` to exactly the ten local modules above.

export * from "../../../../gas_shared/ui/index.js";
export { aarsChip } from "./ui/aarsChip.js";
export { outcomeBadge, outcomeLabel, outcomeNote } from "./ui/outcome.js";
export { tierBadge, tierLabel } from "./ui/posture.js";
export { latticeGrid } from "./ui/lattice.js";
export { latticeSection } from "./ui/latticeSection.js";
export { claimOffsets, claimRail } from "./ui/claimRail.js";
export { diagRow, diagWarn, paintUnknownRates } from "./ui/diagList.js";
export { prunePanel, prunePanelView } from "./ui/prunePanel.js";
export {
  registerWideNote, scopeNote, trendScopeNote, trendScopeView,
} from "./ui/projectScope.js";
