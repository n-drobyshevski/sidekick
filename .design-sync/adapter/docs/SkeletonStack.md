---
category: Feedback
---

# SkeletonStack

Several skeleton blocks in a column, for a list or a table that has not arrived.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `count` | `number` | yes |  |
| `gap` | `string` | — | Default "12px". |
| `height` | `string` | — |  |
| `widths` | `string[]` | — | Per-row widths, cycled. |
| `variant` | `string` | — | Default "line". |

## Usage

```jsx
<div style={{ width: 320 }}>
  <SkeletonStack count={4} widths={["100%", "82%", "94%", "60%"]} />
</div>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.skeleton-stack`

> Source: `gas_shared/ui/feedback.js` → `skeletonStack()`.
