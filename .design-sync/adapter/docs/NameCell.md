---
category: Cells
---

# NameCell

A record name with its kind medallion, truncated with the full string available on the clipped span. Takes name AND kind rather than a row, because callers disagree about what the fields are called.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | `string` | yes |  |
| `kind` | `string \| null` | — | No kind, no medallion. |
| `badge` | `React.ReactNode` | — | Appended after the name. |
| `className` | `string` | — |  |

## Usage

```jsx
<NameCell name="payments-api" kind="REPOSITORY" />
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.cell-name-text`
- `.cell-name`

> Source: `gas_shared/ui/nodeCell.js` → `nameCell()`.
