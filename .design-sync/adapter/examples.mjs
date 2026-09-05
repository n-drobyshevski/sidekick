// One representative usage per component, in the register's own domain — SAST / SCA /
// secrets findings, MTTR, severity distributions. These drive three things: the authored
// preview cards, the usage snippet in each component's doc, and the crash-prevention props
// the floor card renders with.
//
// `stories` is a list of [ExportName, jsxSource]. The first is the canonical one.

export const EXAMPLES = {
  // ---------------------------------------------------------------- Controls
  KpiCard: {
    stories: [
      ['Default', `<KpiCard label="Mean time to remediate" value="18.4d" sub="across 1,284 findings" />`],
      ['WithChip', `<KpiCard
  label="SLA compliance"
  value="87%"
  sub="critical findings, last 90 days"
  chip={<StatusPill kind="warn" text="Below target" />}
/>`],
      ['WithHelp', `<KpiCard
  label="Open secrets"
  value="843"
  sub="removed is not rotated"
  help="A secret leaving the register means the string left HEAD. The credential is live until rotated_at says otherwise."
/>`],
    ],
  },
  StatRow: {
    stories: [
      ['Default', `<StatRow name="SAST" value="412" sub="open findings" />`],
      ['WithMeter', `<StatRow name="Remediated" value="68%" sub="within SLA window" meterPct={68} />`],
    ],
  },
  StatusPill: {
    stories: [
      ['AllStates', `<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
  <StatusPill kind="ok" text="Within SLA" />
  <StatusPill kind="warn" text="Due in 3d" />
  <StatusPill kind="bad" text="Overdue" />
  <StatusPill kind="neutral" text="Not assessed" />
</div>`],
    ],
  },
  Segmented: {
    stories: [
      ['Default', `<Segmented
  ariaLabel="Register scope"
  value="sast"
  onChange={() => {}}
  options={[
    { value: "sast", label: "SAST" },
    { value: "sca", label: "SCA" },
    { value: "secrets", label: "Secrets" },
  ]}
/>`],
    ],
  },
  TogglePills: {
    stories: [
      ['Severity', `<TogglePills
  ariaLabel="Severity filter"
  selected={["CRITICAL", "HIGH"]}
  onToggle={() => {}}
  options={["CRITICAL", "HIGH", "MEDIUM", "LOW"]}
/>`],
    ],
  },
  SelectField: {
    stories: [
      ['Default', `<SelectField label="Order">
  <Select
    ariaLabel="Order"
    value="mttr"
    onChange={() => {}}
    options={[
      { value: "mttr", label: "Slowest to fix" },
      { value: "age", label: "Oldest first" },
    ]}
  />
</SelectField>`],
    ],
  },
  Select: {
    stories: [
      ['Default', `<Select
  ariaLabel="Rows per page"
  value="50"
  onChange={() => {}}
  options={["25", "50", "100", "250"]}
/>`],
    ],
  },
  Field: {
    stories: [
      ['Default', `<Field id="sla-window" label="SLA window" hint="Days allowed before a critical finding is overdue.">
  <input id="sla-window" type="number" defaultValue={30} />
</Field>`],
    ],
  },
  FilterChipRow: {
    stories: [
      ['Default', `<FilterChipRow
  onPatch={() => {}}
  onClearAll={() => {}}
  entries={[
    { key: "sev", label: "Severity", value: "CRITICAL, HIGH" },
    { key: "scope", label: "Scope", value: "secrets" },
    { key: "repo", label: "Repository", value: "payments-api", isDefault: true },
  ]}
/>`],
    ],
  },
  HeroStat: {
    stories: [
      ['Default', `<HeroStat
  label="Median time to remediate"
  value="18.4 days"
  sub="1,284 findings closed; 312 still open and right-censored"
/>`],
    ],
  },
  PageHeader: {
    stories: [
      ['Default', `<PageHeader
  hero={<HeroStat label="Median time to remediate" value="18.4 days" sub="1,284 findings closed" />}
  aside={<SevSegmentBar counts={{ CRITICAL: 24, HIGH: 96, MEDIUM: 210, LOW: 62 }} label="Open findings by severity" />}
  stats={
    <>
      <StatRow name="SAST" value="412" sub="open" />
      <StatRow name="SCA" value="318" sub="open" />
      <StatRow name="Secrets" value="843" sub="open" />
    </>
  }
/>`],
    ],
  },

  // -------------------------------------------------------------------- Data
  Meter: {
    stories: [
      ['Default', `<Meter value={68} label="Remediation coverage, 68 percent" />`],
      ['Decorative', `<Meter value={34} decorative />`],
    ],
  },
  ProgressBar: {
    stories: [
      ['Determinate', `<ProgressBar pct={62} />`],
      ['Indeterminate', `<ProgressBar pct={null} />`],
    ],
  },
  DataTable: {
    stories: [
      ['Default', `<DataTable
  sort={{ key: "age", descending: true }}
  onSort={() => {}}
  columns={[
    { key: "rule", label: "Rule", sortable: true, cell: (r) => r.rule },
    { key: "repo", label: "Repository", sortable: true, cell: (r) => r.repo },
    { key: "sev", label: "Severity", sortable: true, cell: (r) => r.sev },
    { key: "age", label: "Age", sortable: true, cell: (r) => r.age },
  ]}
  rows={[
    { rule: "Hardcoded credential", repo: "payments-api", sev: "CRITICAL", age: "41d" },
    { rule: "SQL injection", repo: "ledger-svc", sev: "HIGH", age: "23d" },
    { rule: "Path traversal", repo: "report-gen", sev: "HIGH", age: "12d" },
    { rule: "Weak cipher", repo: "auth-edge", sev: "MEDIUM", age: "8d" },
  ]}
/>`],
      ['Empty', `<DataTable
  columns={[
    { key: "rule", label: "Rule", cell: (r) => r.rule },
    { key: "repo", label: "Repository", cell: (r) => r.repo },
  ]}
  rows={[]}
  emptyText="No findings match these filters."
/>`],
    ],
  },
  Pager: {
    stories: [
      ['Paged', `<Pager page={2} pageCount={12} total={573} onPage={() => {}} />`],
      ['SinglePage', `<Pager page={0} pageCount={1} total={18} onPage={() => {}} />`],
    ],
  },
  TableFooter: {
    stories: [
      ['Default', `<div style={{ width: 520 }}>
  <TableFooter page={2} pageCount={12} total={573} pageSize={50} onPage={() => {}} onPageSize={() => {}} />
</div>`],
    ],
  },
  AxisBar: {
    stories: [
      ['Default', `<div style={{ width: 420 }}>
  <AxisBar
    unit="findings"
    values={["CRITICAL", "HIGH", "MEDIUM", "LOW"]}
    reading={{
      total: 392,
      counts: { CRITICAL: 24, HIGH: 96, MEDIUM: 210, LOW: 62 },
      unknowns: { MEDIUM: 40, LOW: 18 },
    }}
  />
</div>`],
    ],
  },
  PointRail: {
    stories: [
      ['Default', `<PointRail name="Exploitability" value={62} max={100} onChange={() => {}} />`],
    ],
  },

  // ---------------------------------------------------------------- Feedback
  ErrorState: {
    stories: [
      ['Default', `<ErrorState
  message="Could not reach the Wiz API."
  onRetry={() => {}}
  detail="HTTP 400 VALIDATION_INVALID_TYPE_VARIABLE: SASTFindingFilters.severity expects SASTSeverityFilter"
/>`],
    ],
  },
  Skeleton: {
    stories: [
      ['Variants', `<div style={{ display: "grid", gap: 12, width: 320 }}>
  <Skeleton variant="title" />
  <Skeleton variant="line" />
  <Skeleton variant="line" width="70%" />
  <Skeleton variant="stat" />
</div>`],
    ],
  },
  SkeletonStack: {
    stories: [
      ['Default', `<div style={{ width: 320 }}>
  <SkeletonStack count={4} widths={["100%", "82%", "94%", "60%"]} />
</div>`],
    ],
  },
  EmptyState: {
    stories: [
      ['Default', `<EmptyState
  message="No secrets findings in this scope."
  hint="Severity defaults to MEDIUM and above here — PASSWORD and CERTIFICATE both sit below HIGH."
/>`],
    ],
  },

  // ---------------------------------------------------------------- Settings
  SettingsPanel: {
    stories: [
      ['Default', `<SettingsPanel
  title="Remediation SLA"
  description="How long each severity may stay open before the register calls it overdue."
  footer={
    <SaveBar
      countText="2 unsaved changes"
      changes={[
        { label: "Critical", tab: "sla", tabLabel: "SLA" },
        { label: "High", tab: "sla", tabLabel: "SLA" },
      ]}
      onSave={() => {}}
      onDiscard={() => {}}
    />
  }
>
  <SettingRow label="Critical" description="Days before a critical finding is overdue." htmlFor="sla-crit">
    <SwitchToggle id="sla-crit" checked onChange={() => {}} />
  </SettingRow>
  <SettingRow label="High" description="Days before a high finding is overdue." htmlFor="sla-high">
    <SwitchToggle id="sla-high" onChange={() => {}} />
  </SettingRow>
</SettingsPanel>`],
    ],
  },
  SettingRow: {
    stories: [
      ['Default', `<SettingRow
  label="Count open findings as right-censored"
  description="Keeps unresolved findings in the MTTR curve instead of dropping them."
  htmlFor="censor"
>
  <SwitchToggle id="censor" checked onChange={() => {}} />
</SettingRow>`],
    ],
  },
  SwitchToggle: {
    stories: [
      ['States', `<div style={{ display: "flex", gap: 16, alignItems: "center" }}>
  <SwitchToggle id="sw-on" checked ariaLabel="On" onChange={() => {}} />
  <SwitchToggle id="sw-off" ariaLabel="Off" onChange={() => {}} />
  <SwitchToggle id="sw-dis" checked disabled ariaLabel="Disabled" onChange={() => {}} />
</div>`],
    ],
  },
  TabList: {
    stories: [
      ['Default', `<TabList
  ariaLabel="Register"
  active="sast"
  onSelect={() => {}}
  tabs={[
    { id: "sast", label: "SAST" },
    { id: "sca", label: "SCA" },
    { id: "secrets", label: "Secrets" },
  ]}
/>`],
    ],
  },
  SaveBar: {
    stories: [
      ['Default', `<SaveBar
  countText="3 unsaved changes"
  changes={[
    { label: "Critical SLA", tab: "sla", tabLabel: "SLA" },
    { label: "High SLA", tab: "sla", tabLabel: "SLA" },
    { label: "Right-censoring", tab: "metrics", tabLabel: "Metrics" },
  ]}
  onSave={() => {}}
  onDiscard={() => {}}
  onJump={() => {}}
/>`],
    ],
  },
  Disclosure: {
    stories: [
      ['Default', `<Disclosure summary="Why this finding has no resolved date">
  <p className="small muted">
    SASTFinding exposes createdAt but no resolvedAt, and status: RESOLVED returns 0 rows.
    The ledger dates the death by disappearance instead.
  </p>
</Disclosure>`],
    ],
  },

  // ---------------------------------------------------------------- Severity
  SevBadge: {
    stories: [
      ['Scale', `<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
  <SevBadge severity="CRITICAL" />
  <SevBadge severity="HIGH" />
  <SevBadge severity="MEDIUM" />
  <SevBadge severity="LOW" />
  <SevBadge severity="INFO" />
</div>`],
    ],
  },
  SevSegmentBar: {
    stories: [
      ['Default', `<SevSegmentBar
  counts={{ CRITICAL: 24, HIGH: 96, MEDIUM: 210, LOW: 62 }}
  label="Open findings by severity"
/>`],
      ['Sizes', `<div style={{ display: "grid", gap: 12, width: 360 }}>
  <SevSegmentBar size="sm" counts={{ CRITICAL: 24, HIGH: 96, MEDIUM: 210 }} label="Small" />
  <SevSegmentBar size="md" counts={{ CRITICAL: 24, HIGH: 96, MEDIUM: 210 }} label="Medium" />
  <SevSegmentBar size="lg" counts={{ CRITICAL: 24, HIGH: 96, MEDIUM: 210 }} label="Large" />
</div>`],
    ],
  },
  SevKeyRow: {
    stories: [
      ['Default', `<SevKeyRow counts={{ CRITICAL: 24, HIGH: 96, MEDIUM: 210, LOW: 62 }} />`],
    ],
  },

  // ------------------------------------------------------------------- Sheet
  SheetSection: {
    stories: [
      ['Default', `<SheetSection label="Findings">
  <SheetRow
    title="Hardcoded credential in config/database.yml"
    note="payments-api · line 42"
    badge={<SevBadge severity="CRITICAL" />}
  />
</SheetSection>`],
    ],
  },
  SheetRow: {
    stories: [
      ['Default', `<SheetRow
  title="Hardcoded credential in config/database.yml"
  note="payments-api · first seen 41 days ago"
  fix="Move the value to a secret manager and rotate the credential — removal from HEAD is not rotation."
  badge={<SevBadge severity="CRITICAL" />}
/>`],
    ],
  },
  SectionLabel: {
    stories: [
      ['Default', `<SectionLabel text="Remediation coverage" help="The share of findings closed within their SLA window." />`],
    ],
  },

  // ------------------------------------------------------------------- Cells
  Absent: {
    stories: [
      ['InContext', `<table className="data" style={{ width: 420 }}>
  <thead>
    <tr><th>Repository</th><th>Last scan</th><th>Secrets</th></tr>
  </thead>
  <tbody>
    <tr><td>payments-api</td><td>2 hours ago</td><td>12</td></tr>
    <tr><td>ledger-svc</td><td><Absent /></td><td><Absent /></td></tr>
    <tr><td>report-gen</td><td>6 days ago</td><td>0</td></tr>
  </tbody>
</table>`],
    ],
  },
  TriCell: {
    stories: [
      ['States', `<div style={{ display: "flex", gap: 16 }}>
  <TriCell value={true} />
  <TriCell value={false} />
  <TriCell value={null} />
</div>`],
    ],
  },
  NameCell: {
    stories: [
      ['Default', `<NameCell name="payments-api" kind="REPOSITORY" />`],
    ],
  },

  // -------------------------------------------------------------------- Code
  CodeBlock: {
    stories: [
      ['Default', `<CodeBlock label="Reproduce" text={"npm run probe -- --schema\\n# copy the OBJECT_FILTERS entry, never infer it"} />`],
    ],
  },
  CopyButton: {
    stories: [
      ['Default', `<CopyButton getText={() => "CVE-2024-3094"} title="Copy the CVE identifier" />`],
    ],
  },

  // ------------------------------------------------------------------- Brand
  BrandMark: {
    stories: [
      ['Default', `<BrandMark size={72} />`],
      ['Compact', `<BrandMark size={72} compact label="Wiz Sidekick" />`],
    ],
  },
  UiIcon: {
    stories: [
      ['Set', `<div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 20, width: 420 }}>
  {["search", "filter", "table", "graph", "check", "external", "close", "chevron-down",
    "plus", "minus", "eye", "eye-off", "link", "braces", "folder", "tag", "doc", "pencil"].map((n) => (
    <div key={n} style={{ display: "grid", justifyItems: "center", gap: 6 }}>
      <UiIcon name={n} size={24} />
      <span style={{ fontSize: 9, color: "var(--text-2)" }}>{n}</span>
    </div>
  ))}
</div>`],
    ],
  },
  TipMark: {
    stories: [
      ['InContext', `<div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
  <span>Remediation coverage</span>
  <TipMark />
</div>`],
    ],
  },

  // ------------------------------------------------------------------ Inputs
  FilterCombobox: {
    stories: [
      ['Default', `<FilterCombobox
  ariaLabel="Repository"
  value="payments-api"
  onChange={() => {}}
  options={["payments-api", "ledger-svc", "report-gen", "auth-edge"]}
/>`],
    ],
  },
  TokenList: {
    stories: [
      ['Default', `<TokenList
  ariaLabel="Repositories"
  values={["payments-api", "ledger-svc"]}
  options={["payments-api", "ledger-svc", "report-gen", "auth-edge"]}
  onChange={() => {}}
/>`],
    ],
  },
  RuleGrip: {
    stories: [
      ['InContext', `<div style={{ width: 360, display: "grid", gap: 4 }}>
  {["Exploitability", "Asset exposure", "Data sensitivity"].map((label) => (
    <div key={label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", border: "1px solid var(--hairline)", borderRadius: "var(--radius-md)" }}>
      <RuleGrip />
      <span>{label}</span>
    </div>
  ))}
</div>`],
    ],
  },
};
