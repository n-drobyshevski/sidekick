---
category: Brand
---

# BrandMark

The Sidekick mark. Decorative by default - it sits next to the wordmark almost everywhere, and announcing the picture as well as the name would say it twice. Pass label only where the mark is the only identity on screen.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `size` | `number` | — | Default 96. |
| `compact` | `boolean` | — | The narrow variant for a collapsed rail. |
| `label` | `string` | — | Give it an accessible name. Only where the wordmark is hidden. |

## Usage

```jsx
<BrandMark size={72} />
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.brand-mark`
- `.brand-mark--compact`
- `.mark-ink`
- `.mark-ink-fill`
- `.mark-knockout`

> Source: `gas_devsecops/src/client/js/ui/brandMark.js` → `brandMark()`.
