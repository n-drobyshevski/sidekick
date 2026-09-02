---
category: Controls
---

# StatRow

One cell of a .stat-list strip: uppercase name, the figure (optionally with a meter), and a muted sub-line saying what it counts. Borderless by design - a stat strip takes its emphasis from position and hairlines, not from surfaces.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | `string` | yes | The uppercase dimension name. |
| `value` | `string \| number` | yes | The figure. |
| `sub` | `string` | — | Muted sub-line saying what the figure counts. |
| `meterPct` | `number \| null` | — | 0-100 draws a meter beside the figure; null or undefined draws none. |
| `help` | `Help` | — |  |

## Usage

```jsx
<StatRow name="SAST" value="412" sub="open findings" />
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.stat-row`
- `.stat-name`
- `.stat-figure`
- `.mini-value`
- `.num`
- `.meter--stat`
- `.stat-sub`

> Source: `gas_devsecops/src/client/js/ui/controls.js` → `statRow()`.
