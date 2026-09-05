---
category: Feedback
---

# Skeleton

Loading placeholder block: a calm opacity pulse, no shimmer sweep - DESIGN.md forbids the SaaS tell. aria-hidden, so screen readers hear the page role=status label instead. Reduced motion drops the pulse for a static hairline block.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `variant` | `"line" \| "title" \| "stat" \| "pill" \| "chart" \| ""` | — | Sets default height and radius. |
| `width` | `string` | — |  |
| `height` | `string` | — |  |
| `radius` | `string` | — |  |

## Usage

```jsx
<div style={{ display: "grid", gap: 12, width: 320 }}>
  <Skeleton variant="title" />
  <Skeleton variant="line" />
  <Skeleton variant="line" width="70%" />
  <Skeleton variant="stat" />
</div>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.skeleton`

> Source: `gas_shared/ui/feedback.js` → `skeleton()`.
