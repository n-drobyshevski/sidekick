---
category: Data
---

# DataTable

The sortable record table: .table-wrap > table.data, with sortable headers and rows that open a record. Sort direction stays with the caller - this only needs to know which column is active and whether it reads descending.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `columns` | `Column[]` | yes |  |
| `rows` | `any[]` | yes |  |
| `sort` | `{ key: string; descending: boolean } \| null` | — | The active column, or null for unsorted. |
| `onSort` | `(key: string) => void` | — |  |
| `onRowOpen` | `(row: any) => void` | — | Makes each row a keyboard-operable button. |
| `rowLabel` | `(row: any) => string` | — | That row button's accessible name. |
| `emptyText` | `string` | — |  |
| `className` | `string` | — |  |

## Usage

```jsx
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
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.th-sort`
- `.th-sort-glyph`
- `.clickable`
- `.detail-row`
- `.table-empty`
- `.th-groups`
- `.table-wrap`
- `.table-wrap--panel`
- `.data`

> Source: `gas_devsecops/src/client/js/ui/data.js` → `dataTable()`.
