---
category: Data
---

# AxisBar

One distribution drawn along a fixed axis: a segment per axis VALUE, grown by its share. `unknown` is hatched inside the value it belongs to rather than split off as a fifth segment — for most axes a row without an established reading still has a value, and a separate segment would claim it did not.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `values` | `string[]` | yes | The axis values, in rank order — the segment names, NOT counts. |
| `reading` | `{ total: number; counts: Record<string, number>; unknowns?: Record<string, number> }` | yes | The tally. Without it the bar reads "not measured yet". |
| `unit` | `string` | — | What the rows are. Default "rows". |

## Usage

```jsx
<div style={{ width: 420 }}>
  <AxisBar
    unit="findings"
    values={["CRITICAL", "HIGH", "MEDIUM", "LOW"]}
    reading={{
      total: 392,
      counts: { CRITICAL: 24, HIGH: 96, MEDIUM: 210, LOW: 62 },
      unknowns: { MEDIUM: 40, LOW: 18 },
    }}
  />
</div>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.axis-bar__track`
- `.axis-bar__legend`
- `.small`
- `.axis-bar`
- `.axis-bar__hatch`
- `.axis-bar__seg`
- `.muted`
- `.axis-bar__key`
- `.axis-bar__swatch`
- `.axis-bar__keyname`
- `.axis-bar__keyn`
- `.axis-bar__keyunk`
- `.axis-bar__total`

> Source: `gas_shared/ui/axisBar.js` → `axisBar()`.
