---
category: Controls
---

# SelectField

A native select with its dimension named beside it, so a sighted reader sees what the control selects rather than a bare box floating with only an aria-label.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `label` | `string` | yes |  |
| `children` | `React.ReactNode` | yes | The control itself - normally a Select. |

## Usage

```jsx
<SelectField label="Order">
  <Select
    ariaLabel="Order"
    value="mttr"
    onChange={() => {}}
    options={[
      { value: "mttr", label: "Slowest to fix" },
      { value: "age", label: "Oldest first" },
    ]}
  />
</SelectField>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.select-field`
- `.select-field-label`

> Source: `gas_shared/ui/controls.js` → `selectField()`.
