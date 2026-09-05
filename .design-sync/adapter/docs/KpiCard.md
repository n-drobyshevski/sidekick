---
category: Controls
---

# KpiCard

A KPI tile: label, the figure, an optional chip beside it and a muted sub-line.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `label` | `string` | yes |  |
| `value` | `string \| number` | yes |  |
| `sub` | `string` | — |  |
| `chip` | `React.ReactNode` | — | Rendered inside the value line - normally a StatusPill. |
| `help` | `Help` | — |  |

## Usage

```jsx
<KpiCard label="Mean time to remediate" value="18.4d" sub="across 1,284 findings" />
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.kpi-card`
- `.kpi-label`
- `.kpi-value`
- `.num`
- `.kpi-sub`

> Source: `gas_shared/ui/controls.js` → `kpiCard()`.
