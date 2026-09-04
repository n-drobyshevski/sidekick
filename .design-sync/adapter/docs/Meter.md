---
category: Data
---

# Meter

A proportion drawn as a track and a fill. Decorative when the number is already written beside it, a real progressbar when it is not.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `value` | `number` | yes |  |
| `max` | `number` | — | Default 100. |
| `label` | `string` | — | The accessible name. Omit only when decorative. |
| `decorative` | `boolean` | — | aria-hidden instead of a second announcement of a figure already on screen. |
| `className` | `string` | — |  |
| `help` | `Help` | — |  |

## Usage

```jsx
<Meter value={68} label="Remediation coverage, 68 percent" />
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.meter`
- `.meter-fill`

> Source: `gas_shared/ui/data.js` → `meter()`.
