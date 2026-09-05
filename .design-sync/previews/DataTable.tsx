import { DataTable } from "@wiz-sidekick/design-system";

export const Default = () => (
  <DataTable
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
  />
);

export const Empty = () => (
  <DataTable
    columns={[
      { key: "rule", label: "Rule", cell: (r) => r.rule },
      { key: "repo", label: "Repository", cell: (r) => r.repo },
    ]}
    rows={[]}
    emptyText="No findings match these filters."
  />
);
