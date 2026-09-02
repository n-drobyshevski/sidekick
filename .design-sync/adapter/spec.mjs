// The component spec: ONE source of truth for the React adapters, their prop contracts and
// their docs. gen.mjs emits src/components/<Name>.jsx and dist/index.d.ts from this.
//
// `call` is JS source evaluated with `p` = props and `S` = the portal slot nodes.
// `slots` names props delivered to the factory as real DOM Nodes (React children portalled
// into a detached display:contents div), for factories whose signature takes a Node.
// `after` is JS run against the built node, for factories that populate via a method.

export const SHARED_TYPES = [
  '/** The three shapes every `help` prop in this system accepts (see ui/tip.js tipLabel). */',
  'export type Help = string | string[] | { lines?: string[]; term?: string };',
  '',
  '/** The severity scale. Byte-identical across all four Wiz Sidekick surfaces. */',
  'export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO" | "UNKNOWN";',
  '',
  '/** A severity distribution as the factories consume it. */',
  'export interface SevEntry { sev: Severity; count: number; }',
  '',
  '/** An option in a segmented / select / pill group. */',
  'export interface Option { value: string; label: string; ariaLabel?: string; title?: string; }',
  '',
  '/** A column of the sortable record table. */',
  'export interface Column {',
  '  key: string;',
  '  label: string;',
  '  sortable?: boolean;',
  '  className?: string;',
  '  cell?: (row: any) => string | number | Node;',
  '}',
].join('\n');

export const COMPONENTS = [
  // ---------------------------------------------------------------- Controls
  {
    name: 'StatusPill', factory: 'statusPill', mod: 'controls', group: 'Controls',
    doc: 'OK / warn / bad / neutral state, with a dot the colour never carries alone.',
    props: [
      { n: 'kind', t: '"ok" | "warn" | "bad" | "neutral"', req: true, d: 'Which state token dresses the pill.' },
      { n: 'text', t: 'string', req: true, d: 'One or two words naming the state.' },
      { n: 'help', t: 'Help', d: 'What the state actually means - a pill rarely tells the whole story.' },
    ],
    call: 'statusPill(p.kind, p.text, p.help)',
  },
  {
    name: 'StatRow', factory: 'statRow', mod: 'controls', group: 'Controls',
    doc: 'One cell of a .stat-list strip: uppercase name, the figure (optionally with a meter), and a muted sub-line saying what it counts. Borderless by design - a stat strip takes its emphasis from position and hairlines, not from surfaces.',
    props: [
      { n: 'name', t: 'string', req: true, d: 'The uppercase dimension name.' },
      { n: 'value', t: 'string | number', req: true, d: 'The figure.' },
      { n: 'sub', t: 'string', d: 'Muted sub-line saying what the figure counts.' },
      { n: 'meterPct', t: 'number | null', d: '0-100 draws a meter beside the figure; null or undefined draws none.' },
      { n: 'help', t: 'Help' },
    ],
    call: 'statRow(p.name, p.value, p.sub, p.meterPct, p.help)',
  },
  {
    name: 'Segmented', factory: 'segmented', mod: 'controls', group: 'Controls',
    doc: 'One joined group of aria-pressed buttons - the exclusive-choice recipe. Uses aria-pressed rather than role=radiogroup deliberately: a conformant radiogroup needs a roving tabindex plus arrow cycling, and running two keyboard patterns for one visual recipe is the invented-control problem.',
    props: [
      { n: 'options', t: 'Option[]', req: true },
      { n: 'value', t: 'string', req: true, d: "The currently pressed option's value." },
      { n: 'onChange', t: '(value: string) => void', req: true },
      { n: 'ariaLabel', t: 'string' },
      { n: 'className', t: 'string' },
    ],
    call: 'segmented({ options: p.options, value: p.value, onChange: p.onChange || (() => {}), ariaLabel: p.ariaLabel || "", className: p.className || "" })',
  },
  {
    name: 'TogglePills', factory: 'togglePills', mod: 'controls', group: 'Controls',
    doc: 'A row of aria-pressed toggle pills over a set of values. pillClass keeps each row its own vocabulary, so a chosen node type and a chosen LOW never look like the same thing.',
    props: [
      { n: 'options', t: 'Array<string | Option>', req: true },
      { n: 'selected', t: 'string | string[]', req: true },
      { n: 'onToggle', t: '(value: string) => void', req: true },
      { n: 'ariaLabel', t: 'string' },
      { n: 'pillClass', t: 'string', d: 'Defaults to "sev-pill".' },
      { n: 'sevClass', t: 'boolean', d: 'Append sev-<value> to each pill. Default true.' },
    ],
    call: 'togglePills({ options: p.options, selected: p.selected, onToggle: p.onToggle || (() => {}), ariaLabel: p.ariaLabel || "", pillClass: p.pillClass === undefined ? "sev-pill" : p.pillClass, sevClass: p.sevClass !== false })',
  },
  {
    name: 'SelectField', factory: 'selectField', mod: 'controls', group: 'Controls',
    doc: 'A native select with its dimension named beside it, so a sighted reader sees what the control selects rather than a bare box floating with only an aria-label.',
    props: [
      { n: 'label', t: 'string', req: true },
      { n: 'children', t: 'React.ReactNode', req: true, d: 'The control itself - normally a Select.' },
    ],
    slots: ['children'],
    call: 'selectField(p.label, S.children)',
  },
  {
    name: 'Select', factory: 'select', mod: 'controls', group: 'Controls',
    doc: 'The select element itself: options as strings or {value,label}, with value preselected.',
    props: [
      { n: 'options', t: 'Array<string | Option>', req: true },
      { n: 'value', t: 'string', req: true },
      { n: 'onChange', t: '(value: string) => void', req: true },
      { n: 'ariaLabel', t: 'string' },
      { n: 'placeholder', t: 'string' },
    ],
    call: 'select({ options: p.options, value: p.value, onChange: p.onChange || (() => {}), ariaLabel: p.ariaLabel, placeholder: p.placeholder })',
  },
  {
    name: 'Field', factory: 'field', mod: 'controls', group: 'Controls',
    doc: 'A labelled field. The visible label IS the accessible name (a real label-for), and the hint rides along as aria-describedby - so voice control can address the field by the words next to it. Give your control the same id you pass here.',
    props: [
      { n: 'id', t: 'string', req: true, d: 'Must match the id on the control you pass as children.' },
      { n: 'label', t: 'string', req: true },
      { n: 'children', t: 'React.ReactNode', req: true, d: 'The input. Set its id to `id` so the label associates.' },
      { n: 'hint', t: 'string' },
    ],
    slots: ['children'],
    call: 'field(p.id, p.label, S.children, p.hint)',
  },
  {
    name: 'FilterChipRow', factory: 'filterChipRow', mod: 'controls', group: 'Controls',
    doc: 'The applied-filter chips: what is narrowing the view right now, each dismissible. A chip splits into a label that opens the panel at that filter and a cross that clears it, so clicking the thing you want to change does not delete it.',
    props: [
      { n: 'entries', t: 'Array<{ key: string; label: string; value: string; sev?: Severity; isDefault?: boolean; patch?: unknown }>', req: true, d: "isDefault prefixes 'Default ·' so the row does not claim the reader applied it." },
      { n: 'onPatch', t: '(patch: unknown) => void', req: true },
      { n: 'onEdit', t: '(key: string) => void' },
      { n: 'onClearAll', t: '() => void' },
      { n: 'emptyText', t: 'string', d: 'Keeps the band height when no filters are applied.' },
      { n: 'className', t: 'string' },
      { n: 'ariaLabel', t: 'string' },
    ],
    call: 'filterChipRow({ onPatch: p.onPatch || (() => {}), onEdit: p.onEdit || null, onClearAll: p.onClearAll || null, emptyText: p.emptyText || "", className: p.className || "", ariaLabel: p.ariaLabel || "Applied filters" })',
    after: 'node.sync(p.entries || [])',
  },
  {
    name: 'HeroStat', factory: 'heroStat', mod: 'controls', group: 'Controls',
    doc: 'The page subject figure. At most ONE per page: a second hero means neither is. Takes its emphasis from size and position, never from a card, a gradient or an accent stripe.',
    props: [
      { n: 'label', t: 'string', req: true },
      { n: 'value', t: 'string | number', req: true },
      { n: 'sub', t: 'string' },
      { n: 'help', t: 'Help' },
    ],
    call: 'heroStat(p.label, p.value, p.sub, p.help)',
  },
  {
    name: 'PageHeader', factory: 'pageHeader', mod: 'controls', group: 'Controls',
    doc: 'The shared page header: a borderless grid closed by a hairline, reading in three levels rather than as a row of equal tiles. hero is the subject, aside is the one thing that qualifies it, stats are the supporting facts. Every slot is optional.',
    props: [
      { n: 'hero', t: 'React.ReactNode', d: 'The subject - normally a HeroStat.' },
      { n: 'aside', t: 'React.ReactNode', d: 'The one thing that qualifies the hero.' },
      { n: 'stats', t: 'React.ReactNode', d: 'Supporting facts - a strip of StatRow.' },
    ],
    slots: ['hero', 'aside', 'stats'],
    call: 'pageHeader({ hero: S.hero, aside: S.aside, stats: S.stats ? [S.stats] : null })',
  },
  {
    name: 'KpiCard', factory: 'kpiCard', mod: 'controls', group: 'Controls',
    doc: 'A KPI tile: label, the figure, an optional chip beside it and a muted sub-line.',
    props: [
      { n: 'label', t: 'string', req: true },
      { n: 'value', t: 'string | number', req: true },
      { n: 'sub', t: 'string' },
      { n: 'chip', t: 'React.ReactNode', d: 'Rendered inside the value line - normally a StatusPill.' },
      { n: 'help', t: 'Help' },
    ],
    slots: ['chip'],
    call: 'kpiCard(p.label, p.value, p.sub, S.chip, p.help)',
  },

  // -------------------------------------------------------------------- Data
  {
    name: 'Meter', factory: 'meter', mod: 'data', group: 'Data',
    doc: 'A proportion drawn as a track and a fill. Decorative when the number is already written beside it, a real progressbar when it is not.',
    props: [
      { n: 'value', t: 'number', req: true },
      { n: 'max', t: 'number', d: 'Default 100.' },
      { n: 'label', t: 'string', d: 'The accessible name. Omit only when decorative.' },
      { n: 'decorative', t: 'boolean', d: 'aria-hidden instead of a second announcement of a figure already on screen.' },
      { n: 'className', t: 'string' },
      { n: 'help', t: 'Help' },
    ],
    call: 'meter(p.value, { max: p.max === undefined ? 100 : p.max, label: p.label || "", decorative: !!p.decorative, className: p.className || "", help: p.help || null })',
  },
  {
    name: 'ProgressBar', factory: 'progressBar', mod: 'data', group: 'Data',
    doc: 'Determinate when given a number, indeterminate when not - the running-scan case.',
    props: [
      { n: 'pct', t: 'number | null', req: true, d: 'A number draws a determinate bar; null or NaN draws the indeterminate one.' },
      { n: 'state', t: 'string', d: 'Extra state class on the track.' },
    ],
    call: 'progressBar(p.pct, p.state || "")',
  },
  {
    name: 'DataTable', factory: 'dataTable', mod: 'data', group: 'Data',
    doc: 'The sortable record table: .table-wrap > table.data, with sortable headers and rows that open a record. Sort direction stays with the caller - this only needs to know which column is active and whether it reads descending.',
    props: [
      { n: 'columns', t: 'Column[]', req: true },
      { n: 'rows', t: 'any[]', req: true },
      { n: 'sort', t: '{ key: string; descending: boolean } | null', d: 'The active column, or null for unsorted.' },
      { n: 'onSort', t: '(key: string) => void' },
      { n: 'onRowOpen', t: '(row: any) => void', d: 'Makes each row a keyboard-operable button.' },
      { n: 'rowLabel', t: '(row: any) => string', d: "That row button's accessible name." },
      { n: 'emptyText', t: 'string' },
      { n: 'className', t: 'string' },
    ],
    call: 'dataTable({ columns: p.columns, rows: p.rows || [], sort: p.sort || null, onSort: p.onSort || null, onRowOpen: p.onRowOpen || null, rowLabel: p.rowLabel || null, emptyText: p.emptyText || "", className: p.className || "" })',
  },
  {
    name: 'Pager', factory: 'pager', mod: 'data', group: 'Data',
    doc: 'Prev/Next controls, or a bare row count when a single page fits.',
    props: [
      { n: 'page', t: 'number', req: true, d: 'Zero-based.' },
      { n: 'pageCount', t: 'number', req: true },
      { n: 'total', t: 'number', req: true, d: 'Rows across every page.' },
      { n: 'onPage', t: '(page: number) => void', req: true },
    ],
    call: 'pager(p.page, p.pageCount, p.total, p.onPage || (() => {}))',
  },
  {
    name: 'TableFooter', factory: 'tableFooter', mod: 'data', group: 'Data',
    doc: 'The pager plus a rows-per-page select. onPageSize receives the page already recomputed for the new size.',
    props: [
      { n: 'page', t: 'number', req: true, d: 'Zero-based.' },
      { n: 'pageCount', t: 'number', req: true },
      { n: 'total', t: 'number', req: true },
      { n: 'pageSize', t: 'number', req: true },
      { n: 'sizes', t: 'number[]', d: 'Defaults to PAGE_SIZES (25/50/100/250).' },
      { n: 'onPage', t: '(page: number) => void' },
      { n: 'onPageSize', t: '(size: number, page: number) => void' },
    ],
    call: 'tableFooter({ page: p.page, pageCount: p.pageCount, total: p.total, pageSize: p.pageSize, sizes: p.sizes, onPage: p.onPage || null, onPageSize: p.onPageSize || null })',
  },
  {
    name: 'AxisBar', factory: 'axisBar', mod: 'axisBar', group: 'Data',
    doc: 'One distribution drawn along a fixed axis: a segment per axis VALUE, grown by its share. `unknown` is hatched inside the value it belongs to rather than split off as a fifth segment — for most axes a row without an established reading still has a value, and a separate segment would claim it did not.',
    props: [
      { n: 'values', t: 'string[]', req: true, d: 'The axis values, in rank order — the segment names, NOT counts.' },
      { n: 'reading', t: '{ total: number; counts: Record<string, number>; unknowns?: Record<string, number> }', req: true, d: 'The tally. Without it the bar reads "not measured yet".' },
      { n: 'unit', t: 'string', d: 'What the rows are. Default "rows".' },
    ],
    call: 'axisBar({ values: p.values, unit: p.unit === undefined ? "rows" : p.unit })',
    after: 'node.paint(axisSegments(p.reading, p.values))',
  },
  {
    name: 'PointRail', factory: 'pointRail', mod: 'rail', group: 'Data',
    doc: 'One labelled lane on a 0-max axis, with a slider and an exact number field over the same value. draggable:false keeps the drawing and drops the thumb - for a value the model derives rather than one anybody sets.',
    props: [
      { n: 'name', t: 'string', req: true },
      { n: 'value', t: 'number', d: 'Default 0.' },
      { n: 'max', t: 'number', d: 'Default 100.' },
      { n: 'draggable', t: 'boolean', d: 'Default true.' },
      { n: 'ariaLabel', t: 'string' },
      { n: 'exactLabel', t: 'string' },
      { n: 'onChange', t: '(value: number) => void' },
    ],
    call: 'pointRail({ name: p.name, value: p.value === undefined ? 0 : p.value, max: p.max === undefined ? 100 : p.max, draggable: p.draggable !== false, ariaLabel: p.ariaLabel, exactLabel: p.exactLabel, onChange: p.onChange || (() => {}) })',
  },

  // ---------------------------------------------------------------- Feedback
  {
    name: 'ErrorState', factory: 'errorState', mod: 'feedback', group: 'Feedback',
    doc: 'Failure, not emptiness: announced via role=alert, retryable in place, and the raw exception demoted into a disclosure instead of printed at the reader as body copy.',
    props: [
      { n: 'message', t: 'string', req: true },
      { n: 'onRetry', t: '() => void', d: 'Draws a "Try again" button.' },
      { n: 'detail', t: 'string', d: 'The raw exception, folded into a "Technical details" disclosure.' },
    ],
    call: 'errorState(p.message, { onRetry: p.onRetry || null, detail: p.detail || null })',
  },
  {
    name: 'Skeleton', factory: 'skeleton', mod: 'feedback', group: 'Feedback',
    doc: 'Loading placeholder block: a calm opacity pulse, no shimmer sweep - DESIGN.md forbids the SaaS tell. aria-hidden, so screen readers hear the page role=status label instead. Reduced motion drops the pulse for a static hairline block.',
    props: [
      { n: 'variant', t: '"line" | "title" | "stat" | "pill" | "chart" | ""', d: 'Sets default height and radius.' },
      { n: 'width', t: 'string' },
      { n: 'height', t: 'string' },
      { n: 'radius', t: 'string' },
    ],
    call: 'skeleton(p.variant || "", { width: p.width, height: p.height, radius: p.radius })',
  },
  {
    name: 'SkeletonStack', factory: 'skeletonStack', mod: 'feedback', group: 'Feedback',
    doc: 'Several skeleton blocks in a column, for a list or a table that has not arrived.',
    props: [
      { n: 'count', t: 'number', req: true },
      { n: 'gap', t: 'string', d: 'Default "12px".' },
      { n: 'height', t: 'string' },
      { n: 'widths', t: 'string[]', d: 'Per-row widths, cycled.' },
      { n: 'variant', t: 'string', d: 'Default "line".' },
    ],
    call: 'skeletonStack(p.count, { gap: p.gap === undefined ? "12px" : p.gap, height: p.height, widths: p.widths, variant: p.variant === undefined ? "line" : p.variant })',
  },
  {
    name: 'EmptyState', factory: 'emptyState', mod: 'feedback', group: 'Feedback',
    doc: 'Nothing to show, and why - distinct from ErrorState, which is a failure.',
    props: [
      { n: 'message', t: 'string', req: true },
      { n: 'hint', t: 'string', d: 'What the reader could do about it.' },
    ],
    call: 'emptyState(p.message, p.hint)',
  },

  // ---------------------------------------------------------------- Settings
  {
    name: 'SettingsPanel', factory: 'settingsPanel', mod: 'settings', group: 'Settings',
    doc: 'A titled panel grouping related settings, with an optional footer for its actions.',
    props: [
      { n: 'title', t: 'string' },
      { n: 'description', t: 'string' },
      { n: 'children', t: 'React.ReactNode', d: 'The panel body - normally a stack of SettingRow.' },
      { n: 'footer', t: 'React.ReactNode' },
    ],
    slots: ['children', 'footer'],
    call: 'settingsPanel({ title: p.title, description: p.description, body: S.children, footer: S.footer })',
  },
  {
    name: 'SettingRow', factory: 'settingRow', mod: 'settings', group: 'Settings',
    doc: 'One setting: its name, a sentence saying what it does, and the control that changes it.',
    props: [
      { n: 'label', t: 'string', req: true },
      { n: 'description', t: 'string' },
      { n: 'children', t: 'React.ReactNode', req: true, d: 'The control - normally a SwitchToggle.' },
      { n: 'htmlFor', t: 'string', d: "The control id, so the label associates with it." },
    ],
    slots: ['children'],
    call: 'settingRow({ label: p.label, description: p.description, control: S.children, htmlFor: p.htmlFor })',
  },
  {
    name: 'SwitchToggle', factory: 'switchToggle', mod: 'settings', group: 'Settings',
    doc: 'A two-state switch. Pair it with a SettingRow whose htmlFor matches this id.',
    props: [
      { n: 'checked', t: 'boolean', d: 'Default false.' },
      { n: 'id', t: 'string' },
      { n: 'ariaLabel', t: 'string' },
      { n: 'disabled', t: 'boolean' },
      { n: 'onChange', t: '(checked: boolean) => void' },
    ],
    call: 'switchToggle({ checked: !!p.checked, id: p.id, ariaLabel: p.ariaLabel, disabled: !!p.disabled, onChange: p.onChange || (() => {}) })',
  },
  {
    name: 'TabList', factory: 'tabList', mod: 'settings', group: 'Settings',
    doc: 'A real ARIA tablist with roving tabindex and arrow-key cycling.',
    props: [
      { n: 'tabs', t: 'Array<{ id: string; label: string }>', req: true },
      { n: 'active', t: 'string', req: true },
      { n: 'onSelect', t: '(id: string) => void', req: true },
      { n: 'ariaLabel', t: 'string' },
      { n: 'idPrefix', t: 'string', d: 'Default "tab".' },
    ],
    call: 'tabList({ tabs: p.tabs, active: p.active, onSelect: p.onSelect || (() => {}), ariaLabel: p.ariaLabel, idPrefix: p.idPrefix === undefined ? "tab" : p.idPrefix })',
  },
  {
    name: 'SaveBar', factory: 'saveBar', mod: 'settings', group: 'Settings',
    doc: 'The unsaved-changes bar: what changed, a jump to each changed field, discard and save. Sticky to the bottom of its container. It is HIDDEN until `changes` is non-empty — a bar offering to save nothing is worse than no bar.',
    props: [
      { n: 'changes', t: 'Array<{ label: string; tab: string; tabLabel: string }>', req: true, d: 'What is unsaved. An empty list hides the bar.' },
      { n: 'countText', t: 'string', d: 'The lead, e.g. "3 unsaved changes".' },
      { n: 'onSave', t: '() => void', req: true },
      { n: 'onDiscard', t: '() => void', req: true },
      { n: 'onJump', t: '(tab: string) => void', d: 'Jump to a changed field, by tab id.' },
      { n: 'saveLabel', t: 'string', d: 'Default "Save changes".' },
    ],
    call: 'saveBar({ onSave: p.onSave || (() => {}), onDiscard: p.onDiscard || (() => {}), onJump: p.onJump || null, saveLabel: p.saveLabel === undefined ? "Save changes" : p.saveLabel })',
    after: 'node.update(p.countText || ((p.changes || []).length + " unsaved changes"), p.changes || [])',
  },
  {
    name: 'Disclosure', factory: 'disclosure', mod: 'settings', group: 'Settings',
    doc: 'A native details/summary fold, for detail that should be available without being in the way.',
    props: [
      { n: 'summary', t: 'string', req: true },
      { n: 'children', t: 'React.ReactNode', req: true },
    ],
    slots: ['children'],
    call: 'disclosure(p.summary, S.children)',
  },

  // ---------------------------------------------------------------- Severity
  {
    name: 'SevBadge', factory: 'sevBadge', mod: 'severity', group: 'Severity',
    doc: 'One severity level as a badge: a dot plus the level in words. role=img, not role=status - a detail sheet paints a dozen of these, and a dozen live regions is an announcement storm.',
    props: [
      { n: 'severity', t: 'Severity', req: true },
    ],
    call: 'sevBadge(p.severity)',
  },
  {
    name: 'SevSegmentBar', factory: 'sevSegmentBar', mod: 'severity', group: 'Severity',
    doc: 'A severity distribution drawn as one bar: a segment per level, grown by its count. Levels with nothing in them are not segments.',
    props: [
      { n: 'counts', t: 'Partial<Record<Severity, number>>', req: true, d: 'A tally. Empty levels are dropped.' },
      { n: 'order', t: 'Severity[]', d: 'Segment order. Defaults to CRITICAL..UNKNOWN.' },
      { n: 'size', t: '"sm" | "md" | "lg"', d: 'Default "md".' },
      { n: 'label', t: 'string', d: 'The accessible name. Omit for a bar whose numbers are already written beside it - it then goes aria-hidden rather than announcing the same figures twice.' },
      { n: 'width', t: 'string', d: 'Inline width, for a bar whose LENGTH carries the total.' },
      { n: 'emptyHatch', t: 'boolean', d: 'Draw a hatched full-width segment when there is nothing to show.' },
    ],
    call: 'sevSegmentBar(sevEntries(p.counts, p.order || DEFAULT_SEV_ORDER), { size: p.size === undefined ? "md" : p.size, label: p.label || "", width: p.width || "", emptyHatch: !!p.emptyHatch })',
  },
  {
    name: 'SevKeyRow', factory: 'sevKeyRow', mod: 'severity', group: 'Severity',
    doc: 'The key that reads a SevSegmentBar: each level, its dot and its count.',
    props: [
      { n: 'counts', t: 'Partial<Record<Severity, number>>', req: true },
      { n: 'order', t: 'Severity[]' },
    ],
    call: 'sevKeyRow(sevEntries(p.counts, p.order || DEFAULT_SEV_ORDER), {})',
  },

  // ------------------------------------------------------------------- Sheet
  {
    name: 'SheetSection', factory: 'sheetSection', mod: 'sheet', group: 'Sheet',
    doc: 'One titled section of a record sheet.',
    props: [
      { n: 'label', t: 'string' },
      { n: 'children', t: 'React.ReactNode', req: true },
    ],
    slots: ['children'],
    call: 'sheetSection(p.label, S.children)',
  },
  {
    name: 'SheetRow', factory: 'sheetRow', mod: 'sheet', group: 'Sheet',
    doc: "One row of a record sheet's issue / finding / relationship list. Becomes a button when onOpen is given, so a row that leads somewhere is reachable by keyboard.",
    props: [
      { n: 'title', t: 'string' },
      { n: 'note', t: 'string' },
      { n: 'fix', t: 'string', d: 'Rendered as a "Recommended fix" block.' },
      { n: 'badge', t: 'React.ReactNode', d: 'Normally a SevBadge.' },
      { n: 'onOpen', t: '() => void', d: 'Makes the whole row a button.' },
      { n: 'ariaLabel', t: 'string' },
      { n: 'extraClass', t: 'string' },
    ],
    slots: ['badge'],
    call: 'sheetRow({ title: p.title, note: p.note, fix: p.fix, badge: S.badge, onOpen: p.onOpen || null, ariaLabel: p.ariaLabel, extraClass: p.extraClass })',
  },
  {
    name: 'SectionLabel', factory: 'sectionLabel', mod: 'sheet', group: 'Sheet',
    doc: 'A section heading that can carry its own definition, so a term is defined where it is read rather than in a paragraph underneath.',
    props: [
      { n: 'text', t: 'string', req: true },
      { n: 'help', t: 'Help' },
    ],
    call: 'sectionLabel(p.text, p.help)',
  },

  // ------------------------------------------------------------------- Cells
  {
    name: 'Absent', factory: 'absent', mod: 'cells', group: 'Cells',
    doc: 'The em-dash cell. Absent is not zero - this is what a value that was never measured looks like.',
    props: [],
    call: 'absent()',
  },
  {
    name: 'TriCell', factory: 'triCell', mod: 'cells', group: 'Cells',
    doc: 'A tri-state cell: true, false, or absent. Wiz returns null for a flag it never evaluated, and collapsing that to false is what makes an unassessed asset render as clean.',
    props: [
      { n: 'value', t: 'boolean | null', req: true },
    ],
    call: 'triCell(p.value)',
  },
  {
    name: 'NameCell', factory: 'nameCell', mod: 'cells', group: 'Cells',
    doc: 'A record name with its kind medallion, truncated with the full string available on the clipped span. Takes name AND kind rather than a row, because callers disagree about what the fields are called.',
    props: [
      { n: 'name', t: 'string', req: true },
      { n: 'kind', t: 'string | null', d: 'No kind, no medallion.' },
      { n: 'badge', t: 'React.ReactNode', d: 'Appended after the name.' },
      { n: 'className', t: 'string' },
    ],
    slots: ['badge'],
    call: 'nameCell(p.name, p.kind, { badge: S.badge, className: p.className })',
  },

  // -------------------------------------------------------------------- Code
  {
    name: 'CodeBlock', factory: 'codeBlock', mod: 'code', group: 'Code',
    doc: 'A monospaced block for a command, a path or a blob, with an optional label.',
    props: [
      { n: 'text', t: 'string', req: true },
      { n: 'label', t: 'string' },
      { n: 'maxHeight', t: 'string' },
    ],
    call: 'codeBlock(p.text, { label: p.label || "", maxHeight: p.maxHeight || "" })',
  },
  {
    name: 'CopyButton', factory: 'copyButton', mod: 'code', group: 'Code',
    doc: 'Copies what getText returns. getText is a function rather than a string so the button can sit beside content that changes without being rebuilt and losing focus. title becomes the accessible name, answering "copy WHAT".',
    props: [
      { n: 'getText', t: '() => string', req: true },
      { n: 'label', t: 'string', d: 'Default "Copy".' },
      { n: 'copiedLabel', t: 'string', d: 'Default "Copied".' },
      { n: 'title', t: 'string', d: 'The accessible name - says what is being copied.' },
    ],
    call: 'copyButton(p.getText || (() => ""), { label: p.label === undefined ? "Copy" : p.label, copiedLabel: p.copiedLabel === undefined ? "Copied" : p.copiedLabel, title: p.title || "" })',
  },

  // ------------------------------------------------------------------- Brand
  {
    name: 'BrandMark', factory: 'brandMark', mod: 'brandMark', group: 'Brand',
    doc: 'The Sidekick mark. Decorative by default - it sits next to the wordmark almost everywhere, and announcing the picture as well as the name would say it twice. Pass label only where the mark is the only identity on screen.',
    props: [
      { n: 'size', t: 'number', d: 'Default 96.' },
      { n: 'compact', t: 'boolean', d: 'The narrow variant for a collapsed rail.' },
      { n: 'label', t: 'string', d: 'Give it an accessible name. Only where the wordmark is hidden.' },
    ],
    call: 'brandMark(p.size === undefined ? 96 : p.size, { compact: !!p.compact, label: p.label || null })',
  },
  {
    name: 'UiIcon', factory: 'uiIcon', mod: 'uiIcons', group: 'Brand',
    doc: 'One stroked interface icon from the set.',
    props: [
      { n: 'name', t: 'UiIconName', req: true },
      { n: 'size', t: 'number', d: 'Default 16.' },
    ],
    call: 'uiIcon(p.name, p.size === undefined ? 16 : p.size)',
  },
  {
    name: 'TipMark', factory: 'tipMark', mod: 'tip', group: 'Brand',
    doc: 'The bare "?" affordance, for a control whose explanation has no chip to ride on.',
    props: [],
    call: 'tipMark()',
  },

  // ------------------------------------------------------------------ Inputs
  {
    name: 'FilterCombobox', factory: 'filterCombobox', mod: 'combobox', group: 'Inputs',
    doc: 'A filtering combobox. editable:true swaps the trigger button for a real text input carrying role=combobox, per the ARIA editable-combobox pattern - DOM focus never leaves the input and the active row travels as aria-activedescendant. Three extras are opt-in and inert unless asked for, so a list that wants to be a plain list stays one.',
    props: [
      { n: 'value', t: 'string', req: true },
      { n: 'options', t: 'Array<string | Option>', req: true },
      { n: 'onChange', t: '(value: string) => void', req: true },
      { n: 'ariaLabel', t: 'string' },
      { n: 'searchPlaceholder', t: 'string', d: 'Default "Search…".' },
      { n: 'defaultLabel', t: 'string' },
      { n: 'fallbackLabel', t: 'string', d: 'Shown for a value the list does not carry.' },
      { n: 'searchThreshold', t: 'number', d: 'Rows before a search box appears. Default 7.' },
      { n: 'editable', t: 'boolean', d: 'Real text input rather than a trigger button.' },
      { n: 'allowCustom', t: 'boolean', d: 'Synthesise a "use what you typed" row. Editable mode only.' },
      { n: 'checkSelected', t: 'boolean', d: 'Mark the chosen row with a glyph rather than colour and weight alone.' },
      { n: 'header', t: '{ title: string; note?: string } | null', d: 'A heading and a sentence above the search.' },
    ],
    call: 'filterCombobox({ value: p.value, options: p.options, onChange: p.onChange || (() => {}), ariaLabel: p.ariaLabel, searchPlaceholder: p.searchPlaceholder === undefined ? "Search…" : p.searchPlaceholder, defaultLabel: p.defaultLabel, fallbackLabel: p.fallbackLabel || "", searchThreshold: p.searchThreshold === undefined ? 7 : p.searchThreshold, editable: !!p.editable, allowCustom: !!p.allowCustom, checkSelected: !!p.checkSelected, header: p.header || null })',
  },
  {
    name: 'TokenList', factory: 'tokenList', mod: 'tokenList', group: 'Inputs',
    doc: 'A set of values as removable chips with a picker to add more. The picker is built ONCE and only the chips are rebuilt - a rebuilt input is a dropped keystroke and focus on body.',
    props: [
      { n: 'values', t: 'string[]', req: true },
      { n: 'options', t: 'Array<string | Option>', d: 'Picker rows.' },
      { n: 'onChange', t: '(next: string[]) => void', req: true },
      { n: 'ariaLabel', t: 'string' },
      { n: 'placeholder', t: 'string', d: 'Default "Add…".' },
      { n: 'emptyText', t: 'string' },
    ],
    call: 'tokenList({ values: p.values || [], options: p.options || [], ariaLabel: p.ariaLabel, placeholder: p.placeholder === undefined ? "Add…" : p.placeholder, emptyText: p.emptyText || "", onChange: p.onChange || (() => {}) })',
  },
  {
    name: 'RuleGrip', factory: 'ruleGrip', mod: 'rowReorder', group: 'Inputs',
    doc: 'The drag handle for a reorderable rule row.',
    props: [],
    call: 'ruleGrip()',
  },
];
