// The shared component base, as one import surface.
//
// The implementations live beside this file — index.js re-exports them so every call site
// keeps one import and the modules stay small enough to read. esbuild flattens the
// re-exports at build time, so the indirection costs nothing at runtime. Each app's own
// `ui.js` re-exports this barrel and adds whatever is genuinely its own.
//
//   dom.js        el, clear, motionOk, downloadText, registerWideNote — the element builder
//   format.js     dates in the display zone, and the two "turn a column into a number"
//                 helpers (sevRank, dueRank) a comparator table sorts on
//   severity.js   the severity marks (dot + word, never colour alone)
//   data.js       quantity display: progress track, the sortable table, the paging footer
//   chartTable.js the data-table alternative under every canvas — the same series a chart
//                 was handed, as a disclosure a keyboard and a screen reader can read
//   tableModel.js how a register orders and pages its rows, and which of its columns it
//                 draws — comparators, where an unknown goes, what a tie does, what a
//                 second press on a heading means, and which columns refuse to be hidden.
//                 DOM-free, so the half that can be WRONG is the half vitest can hold
//   columnPicker.js the "Columns" button and its popover — the reader's own answer to a
//                 register with more columns than their question needs
//   cells.js      what a cell says when the answer is "nothing" or "maybe" — the one muted
//                 em dash, yes/no/unknown
//   nodeCell.js   and what it says when the answer is "this is a node": the kind medallion.
//                 Split from cells.js because it, alone, reaches ../icons.js
//   controls.js   status pills, KPI tiles, stat rows
//   feedback.js   loading / empty / error / toast / dialog / the sync-zone freshness caption /
//                 measuredEmpty, the filter-empty state that says when it looked
//   tip.js        the one hover card: the app's only answer to "what does this mean"
//   tipPlace.js   where that card lands and when it opens — the DOM-free half
//   sheet.js      the drill-down overlay and its section+row vocabulary
//   recordCursor.js  the sheet's DOM-free geometry: stepping a record list, clamping a width
//   combobox.js   the searchable portaled listbox
//   scopeModel.js which slice of the register every page is showing — the DOM-free half:
//                 the kinds an app declares, the value encoding, and the wire payload
//   scopeControl.js and the appbar control that draws it
//   tokenList.js  a rule field holding a LIST of opaque strings: chips + that listbox
//   code.js       a monospace block, and copying out of a sandboxed iframe
//   uiIcons.js    chrome glyphs (close, chevrons, grip) — ../icons.js does node kinds
//   brandMark.js  the product mark: the shell's only imagery
//   rail.js       one value drawn on the shared 0–100 axis, and edited on it
//   popover.js    where a portaled popover sits, and the one contract for closing it
//   portals.js    the open-portal count the sheet's focus trap defers to
//   axisBar.js    what one dimension actually read across the register
//   rowReorder.js the cascade grip: drag as the shortcut, the row's arrows as the control
//   settings.js   the settings form: panel, labelled row, switch, tab strip, one save bar
//   diagnostics.js the Settings -> System read-outs: a grid of read-out cards, and the six
//                 facts the three registers publish between them. Every section is optional
//   usageMeter.js one ratio against a HARD ceiling: a used/total numeral caption plus warn
//                 and bad states, which neither meter() nor progressBar() carries
//   figures.js    the register vocabulary's numeric core: num, fmtCount, days1, pct1,
//                 denomNote, fmtDays, boundedDays, relativeAge, openAndTotal — refuse-before-
//                 cast, so an absent figure never renders as a confident 0 — plus figureCard,
//                 the KPI tile whose denominator sentence rides in the tip and the attribute
//                 instead of as a paragraph under the card
//   quad.js       two yes/no questions crossed: the ordered 2x2, its shares and its one
//                 aria sentence (pure), and the real <th scope> table that draws them
//   sparkline.js  a series as one line at the size of a word: the path (pure, gaps kept as
//                 breaks) and the role="img" SVG around it
//   splitBar.js   one track split into labelled segments, with the figures repeated in words
//                 beneath it — an in/out proportion, or a severity mix
//   unitChart.js  countable quantity as countable marks: the per-table unit ladder and the
//                 part-to-whole model (pure), the inline tally, the waffle lattice and the
//                 key row that is why a waffle owes no chartTable disclosure. The class is
//                 `.isotype` on purpose — the density walker already counts that bucket
//   settingsReadouts.js  what a Settings control is doing to the register, right now: the
//                 with/without split a toggle draws (impactSplitModel/impactSplit), the
//                 severity scan-scope split (severitySplitModel, `inScope` a PREDICATE never
//                 a selected array), a labelled tick sequence that never computes its own
//                 state (tickTimeline), and a cut histogram whose <input type=range> is built
//                 once and never recreated (createCutHistogram)

export { appendAll, clear, downloadText, el, motionOk, registerWideNote } from "./dom.js";
export {
  absentText, boundedDays, days1, denomNote, figureCard, figureCardModel, fmtCount, fmtDays,
  num, openAndTotal, pct1, relativeAge,
} from "./figures.js";
export {
  DISPLAY_TZ, dueRank, fmtDate, fmtDateTime, plural, pluralize, sevRank,
} from "./format.js";
export {
  sevBadge, sevEntries, sevKeyRow, sevSegmentBar, sevSpoken,
} from "./severity.js";
export { dataTable, meter, pager, progressBar, tableFooter } from "./data.js";
export { columnsButton, readStoredColumns, writeStoredColumns } from "./columnPicker.js";
export {
  chartTable, chartTableModel, chartTablePaged, survivalTableModel,
} from "./chartTable.js";
export {
  DEFAULT_COLUMNS, DEFAULT_PAGE_SIZE, PAGE_SIZES, columnChoice, columnChoices, columnShown,
  columnsChanged, compareValues, encodeColumnChoice, hasDefaultHidden, hideableColumn,
  nextSort, nullsLast, pageForSize, pageOf, parseColumnChoice, regroupSpans, sortRows,
  toggleColumn, triState, visibleColumns,
} from "./tableModel.js";
export { absent, triCell } from "./cells.js";
export { nameCell } from "./nodeCell.js";
export {
  field, filterChipRow, heroLines, heroStat, kpiCard, pageHeader, segmented, select,
  selectField, statRow, statusPill, togglePills,
} from "./controls.js";
export {
  confirmDialog, emptyState, errorState, firstRunNotice, measuredEmpty, skeleton,
  skeletonStack, syncCaption, toast,
} from "./feedback.js";
export {
  bookTip, chartTipHandler, closeTip, glossaryTip, tip, tipAnchor, tipLabel, tipLines,
  tipMark, truncTip,
} from "./tip.js";
export {
  closeActiveSheet, openSheet, sectionLabel, sheetRow, sheetSection,
} from "./sheet.js";
export { clampSheetWidth, recordCursor } from "./recordCursor.js";
export { closeCombobox, filterCombobox } from "./combobox.js";
export { tokenList } from "./tokenList.js";
export { openPopover, popoverDismiss, positionPopover } from "./popover.js";
export { portalsOpen } from "./portals.js";
export { codeBlock, copyButton, copyText } from "./code.js";
export { UI_ICON_NAMES, missingUiIcons, uiIcon } from "./uiIcons.js";
export { brandMark } from "./brandMark.js";
export { pointRail, railScale } from "./rail.js";
export { debounce, onPageTeardown, runPageTeardown } from "./timing.js";
export { axisBar, axisSegments } from "./axisBar.js";
export { quadModel, quadTable } from "./quad.js";
export { sparkLabel, sparkPath, sparkline } from "./sparkline.js";
export { rowDrag, ruleGrip } from "./rowReorder.js";
export { splitBar } from "./splitBar.js";
export {
  COUNT_UNITS, FILLS, FINE_UNITS, GRID_CELLS, MAX_EXACT_CELLS, MAX_MARKS, MAX_SEGMENTS,
  TONES, unitChartModel, unitCounts, unitGrid, unitKeyRow, unitRow, unitScale,
} from "./unitChart.js";
export {
  createCutHistogram, impactSplit, impactSplitModel, severitySplitModel, tickTimeline,
} from "./settingsReadouts.js";
export {
  disclosure, saveBar, settingRow, settingsPanel, switchToggle, tabList,
} from "./settings.js";
export {
  DIAGNOSTIC_SECTIONS, buildMismatch, describeStamp, diagnosticCard, diagnosticsPanel,
  errorCountBadge, errorLogBody, normalizeErrorLog, storageBody,
} from "./diagnostics.js";
export { usageMeter } from "./usageMeter.js";
export { encodeScope, parseScope, scopePayload, scopeView } from "./scopeModel.js";
export { scopeControl, scopeSwitch } from "./scopeControl.js";
