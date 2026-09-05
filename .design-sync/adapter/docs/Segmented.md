---
category: Controls
---

# Segmented

One joined group of aria-pressed buttons - the exclusive-choice recipe. Uses aria-pressed rather than role=radiogroup deliberately: a conformant radiogroup needs a roving tabindex plus arrow cycling, and running two keyboard patterns for one visual recipe is the invented-control problem.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `options` | `Option[]` | yes |  |
| `value` | `string` | yes | The currently pressed option's value. |
| `onChange` | `(value: string) => void` | yes |  |
| `ariaLabel` | `string` | — |  |
| `className` | `string` | — |  |

## Usage

```jsx
<Segmented
  ariaLabel="Register scope"
  value="sast"
  onChange={() => {}}
  options={[
    { value: "sast", label: "SAST" },
    { value: "sca", label: "SCA" },
    { value: "secrets", label: "Secrets" },
  ]}
/>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.segmented`

> Source: `gas_shared/ui/controls.js` → `segmented()`.
