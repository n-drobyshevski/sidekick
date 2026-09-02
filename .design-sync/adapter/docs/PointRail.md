---
category: Data
---

# PointRail

One labelled lane on a 0-max axis, with a slider and an exact number field over the same value. draggable:false keeps the drawing and drops the thumb - for a value the model derives rather than one anybody sets.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | `string` | yes |  |
| `value` | `number` | — | Default 0. |
| `max` | `number` | — | Default 100. |
| `draggable` | `boolean` | — | Default true. |
| `ariaLabel` | `string` | — |  |
| `exactLabel` | `string` | — |  |
| `onChange` | `(value: number) => void` | — |  |

## Usage

```jsx
<PointRail name="Exploitability" value={62} max={100} onChange={() => {}} />
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.rail-base`
- `.rail-amp-txt`
- `.rail-amp`
- `.rail-over`
- `.rail-clip`
- `.rail-cap`
- `.rail-track`
- `.rail-lane`
- `.rail-stop`
- `.rail-stops`
- `.rail-num`
- `.rail-name`
- `.rail-rd`
- `.rail`

> Source: `gas_devsecops/src/client/js/ui/rail.js` → `pointRail()`.
