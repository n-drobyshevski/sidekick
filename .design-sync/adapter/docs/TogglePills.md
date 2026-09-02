---
category: Controls
---

# TogglePills

A row of aria-pressed toggle pills over a set of values. pillClass keeps each row its own vocabulary, so a chosen node type and a chosen LOW never look like the same thing.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `options` | `Array<string \| Option>` | yes |  |
| `selected` | `string \| string[]` | yes |  |
| `onToggle` | `(value: string) => void` | yes |  |
| `ariaLabel` | `string` | — |  |
| `pillClass` | `string` | — | Defaults to "sev-pill". |
| `sevClass` | `boolean` | — | Append sev-<value> to each pill. Default true. |

## Usage

```jsx
<TogglePills
  ariaLabel="Severity filter"
  selected={["CRITICAL", "HIGH"]}
  onToggle={() => {}}
  options={["CRITICAL", "HIGH", "MEDIUM", "LOW"]}
/>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.pill-row`
- `.sev-<variant>`

> Source: `gas_devsecops/src/client/js/ui/controls.js` → `togglePills()`.
