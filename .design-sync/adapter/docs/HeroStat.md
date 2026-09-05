---
category: Controls
---

# HeroStat

The page subject figure. At most ONE per page: a second hero means neither is. Takes its emphasis from size and position, never from a card, a gradient or an accent stripe.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `label` | `string` | yes |  |
| `value` | `string \| number` | yes |  |
| `sub` | `string` | — |  |
| `help` | `Help` | — |  |

## Usage

```jsx
<HeroStat
  label="Median time to remediate"
  value="18.4 days"
  sub="1,284 findings closed; 312 still open and right-censored"
/>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.page-hero`
- `.kpi-label`
- `.hero-value`
- `.num`
- `.page-hero-sub`

> Source: `gas_shared/ui/controls.js` → `heroStat()`.
