---
category: Controls
---

# FilterChipRow

The applied-filter chips: what is narrowing the view right now, each dismissible. A chip splits into a label that opens the panel at that filter and a cross that clears it, so clicking the thing you want to change does not delete it.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `entries` | `Array<{ key: string; label: string; value: string; sev?: Severity; isDefault?: boolean; patch?: unknown }>` | yes | isDefault prefixes 'Default ·' so the row does not claim the reader applied it. |
| `onPatch` | `(patch: unknown) => void` | yes |  |
| `onEdit` | `(key: string) => void` | — |  |
| `onClearAll` | `() => void` | — |  |
| `emptyText` | `string` | — | Keeps the band height when no filters are applied. |
| `className` | `string` | — |  |
| `ariaLabel` | `string` | — |  |

## Usage

```jsx
<FilterChipRow
  onPatch={() => {}}
  onClearAll={() => {}}
  entries={[
    { key: "sev", label: "Severity", value: "CRITICAL, HIGH" },
    { key: "scope", label: "Scope", value: "secrets" },
    { key: "repo", label: "Repository", value: "payments-api", isDefault: true },
  ]}
/>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.filter-chips`
- `.filter-chips-empty`
- `.filter-chip-x`
- `.sev-dot`
- `.filter-chip-key`
- `.filter-chip-value`
- `.filter-chip-body`
- `.filter-chip`
- `.sev-`
- `.is-default`
- `.link`
- `.filter-clear-all`

> Source: `gas_shared/ui/controls.js` → `filterChipRow()`.
