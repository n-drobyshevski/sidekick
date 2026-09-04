// The shared component base, as one import surface.
//
// The implementations live in ./ui/*.js — this file re-exports them so every call site
// keeps importing from "../ui.js" and the modules stay small enough to read. esbuild
// flattens the re-exports at build time, so the indirection costs nothing at runtime.
//
//   dom.js        el, clear, motionOk, downloadText, registerWideNote — the element builder
//   format.js     dates in the display zone
//   severity.js   the severity marks (dot + word, never colour alone)
//   data.js       quantity display: progress track, the sortable table, the paging footer
//   chartTable.js the data-table alternative under every canvas — the same series a chart
//                 was handed, as a disclosure a keyboard and a screen reader can read
//   tableModel.js how a register orders and pages its rows — comparators, where an unknown
//                 goes, what a tie does. DOM-free, so the half that can be WRONG is the
//                 half vitest can hold
//   cells.js      what a cell says when the answer is "nothing", "maybe", or "this is a
//                 node" — the one muted em dash, yes/no/unknown, the kind medallion
//   controls.js   status pills, KPI tiles, stat rows
//   feedback.js   loading / empty / error / toast / dialog
//   tip.js        the one hover card: the app's only answer to "what does this mean"
//   tipPlace.js   where that card lands and when it opens — the DOM-free half
//   sheet.js      the drill-down overlay and its section+row vocabulary
//   combobox.js   the searchable portaled listbox
//   tokenList.js  a rule field holding a LIST of opaque strings: chips + that listbox
//   code.js       a monospace block, and copying out of a sandboxed iframe
//   uiIcons.js    chrome glyphs (close, chevrons, grip) — icons.js does node kinds
//   brandMark.js  the product mark: the shell's only imagery
//   rail.js       one value drawn on the shared 0–100 axis, and edited on it
//   popover.js    where a portaled popover sits, and the one contract for closing it
//   portals.js    the open-portal count the sheet's focus trap defers to
//   axisBar.js    what one dimension actually read across the register
//   rowReorder.js the cascade grip: drag as the shortcut, the row's arrows as the control
//   settings.js   the settings form: panel, labelled row, switch, tab strip, one save bar
//   projectScope.js  the app-header project switcher: which slice of the register is shown
//   figures.js    the register vocabulary's numeric core: num, fmtCount, days1, pct1,
//                 denomNote, fmtDays — refuse-before-cast, so an absent figure never renders
//                 as a confident 0

export { appendAll, clear, downloadText, el, motionOk, registerWideNote } from "./ui/dom.js";
export { days1, denomNote, fmtCount, fmtDays, num, pct1 } from "./ui/figures.js";
export {
  DISPLAY_TZ, dueRank, fmtDate, fmtDateTime, plural, pluralize, sevRank,
} from "./ui/format.js";
export {
  sevBadge, sevEntries, sevKeyRow, sevSegmentBar, sevSpoken,
} from "./ui/severity.js";
export { dataTable, meter, pager, progressBar, tableFooter } from "./ui/data.js";
export { chartTable, chartTableModel, survivalTableModel } from "./ui/chartTable.js";
export {
  DEFAULT_PAGE_SIZE, PAGE_SIZES, compareValues, nullsLast, pageForSize, pageOf, sortRows,
  triState,
} from "./ui/tableModel.js";
export { absent, nameCell, triCell } from "./ui/cells.js";
export {
  field, filterChipRow, heroStat, kpiCard, pageHeader, segmented, select, selectField,
  statRow, statusPill, togglePills,
} from "./ui/controls.js";
export {
  confirmDialog, emptyState, errorState, skeleton, skeletonStack, toast,
} from "./ui/feedback.js";
export {
  bookTip, chartTipHandler, closeTip, glossaryTip, tip, tipAnchor, tipLabel, tipLines,
  tipMark, truncTip,
} from "./ui/tip.js";
export {
  closeActiveSheet, openSheet, sectionLabel, sheetRow, sheetSection,
} from "./ui/sheet.js";
export { filterCombobox } from "./ui/combobox.js";
export { tokenList } from "./ui/tokenList.js";
export { openPopover, popoverDismiss, positionPopover } from "./ui/popover.js";
export { portalsOpen } from "./ui/portals.js";
export { codeBlock, copyButton, copyText } from "./ui/code.js";
export { uiIcon } from "./ui/uiIcons.js";
export { brandMark } from "./ui/brandMark.js";
export { pointRail, railScale } from "./ui/rail.js";
export { debounce, onPageTeardown, runPageTeardown } from "./ui/timing.js";
export { axisBar, axisSegments } from "./ui/axisBar.js";
export { rowDrag, ruleGrip } from "./ui/rowReorder.js";
export {
  disclosure, saveBar, settingRow, settingsPanel, switchToggle, tabList,
} from "./ui/settings.js";
export {
  SUPPORT_GROUP_PREFIXES, isSupportGroup, projectKind, projectScopeControl, projectScopeView,
  scopeOptions,
} from "./ui/projectScope.js";
