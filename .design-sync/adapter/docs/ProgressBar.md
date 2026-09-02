---
category: Data
---

# ProgressBar

Determinate when given a number, indeterminate when not - the running-scan case.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `pct` | `number \| null` | yes | A number draws a determinate bar; null or NaN draws the indeterminate one. |
| `state` | `string` | — | Extra state class on the track. |

## Usage

```jsx
<ProgressBar pct={62} />
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.progress-track`
- `.progress-fill`

> Source: `gas_devsecops/src/client/js/ui/data.js` → `progressBar()`.
