---
category: Controls
---

# Select

The select element itself: options as strings or {value,label}, with value preselected.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `options` | `Array<string \| Option>` | yes |  |
| `value` | `string` | yes |  |
| `onChange` | `(value: string) => void` | yes |  |
| `ariaLabel` | `string` | — |  |
| `placeholder` | `string` | — |  |

## Usage

```jsx
<Select
  ariaLabel="Rows per page"
  value="50"
  onChange={() => {}}
  options={["25", "50", "100", "250"]}
/>
```

> Source: `gas_shared/ui/controls.js` → `select()`.
