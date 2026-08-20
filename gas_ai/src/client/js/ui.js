// The shared component base, as one import surface.
//
// The implementations live in ./ui/*.js — this file re-exports them so every call site
// keeps importing from "../ui.js" and the modules stay small enough to read. esbuild
// flattens the re-exports at build time, so the indirection costs nothing at runtime.
//
//   dom.js       el, clear, motionOk, downloadText — the element builder
//   format.js    dates in the display zone
//   severity.js  the severity marks (dot + word, never colour alone)
//   findingsScore.js  the asset-surface reading of the AARS number: percentile first,
//                band demoted to muted context, and the model's display label
//   data.js      quantity display: progress track, pager
//   controls.js  status pills, KPI tiles, stat rows
//   feedback.js  loading / empty / error / toast / dialog / help tip
//   sheet.js     the drill-down overlay and its section+row vocabulary
//   combobox.js  the searchable portaled listbox
//   code.js      a monospace block, and copying out of a sandboxed iframe
//   uiIcons.js   chrome glyphs (close, chevrons, grip) — icons.js does node kinds
//   rail.js      one value drawn on the shared 0–100 axis, and edited on it
//   popover.js   where a portaled popover sits, and the one contract for closing it
//   portals.js   the open-portal count the sheet's focus trap defers to
//   outcome.js   the problem tree's ACT/ATTEND/TRACK*/TRACK badge
//   posture.js   the posture lattice's Tier 1..4 badge
//   lattice.js   the decision lattice: 54 leaves or 27 cells as a grid of cells
//   claimRail.js how much of a closed space one cascade row claims, on a shared axis
//   rowReorder.js the cascade grip: drag as the shortcut, the row's arrows as the control
//   diagList.js  the "is this rule quietly failing" read-out, shared by all three cascades

export { clear, downloadText, el, motionOk } from "./ui/dom.js";
export { DISPLAY_TZ, fmtDate, fmtDateTime, plural, pluralize, sevRank } from "./ui/format.js";
export {
  aarsChip, aarsPercentileMark, sevBadge, sevEntries, sevKeyRow, sevSegmentBar, sevSpoken,
} from "./ui/severity.js";
export {
  FINDINGS_SCORE_LABEL, ordinal, percentileText, scoreChip,
} from "./ui/findingsScore.js";
export { dataTable, meter, pager, progressBar } from "./ui/data.js";
export {
  field, filterChipRow, kpiCard, segmented, select, selectField, statRow, statusPill,
  togglePills,
} from "./ui/controls.js";
export {
  confirmDialog, emptyState, errorState, helpTip, skeleton, skeletonStack, toast,
} from "./ui/feedback.js";
export {
  closeActiveSheet, openSheet, sectionLabel, sheetRow, sheetSection,
} from "./ui/sheet.js";
export { filterCombobox } from "./ui/combobox.js";
export { openPopover, popoverDismiss, positionPopover } from "./ui/popover.js";
export { portalsOpen } from "./ui/portals.js";
export { codeBlock, copyButton, copyText } from "./ui/code.js";
export { uiIcon } from "./ui/uiIcons.js";
export { pointRail, railScale } from "./ui/rail.js";
export { debounce, onPageTeardown, runPageTeardown } from "./ui/timing.js";
export { outcomeBadge, outcomeLabel } from "./ui/outcome.js";
export { tierBadge, tierLabel } from "./ui/posture.js";
export { latticeGrid } from "./ui/lattice.js";
export { latticeSection } from "./ui/latticeSection.js";
export { claimRail, claimOffsets } from "./ui/claimRail.js";
export { rowDrag, ruleGrip } from "./ui/rowReorder.js";
export { diagRow, diagWarn, paintUnknownRates } from "./ui/diagList.js";
