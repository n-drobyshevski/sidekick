---
category: Data
---

# Pager

Prev/Next controls, or a bare row count when a single page fits.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `page` | `number` | yes | Zero-based. |
| `pageCount` | `number` | yes |  |
| `total` | `number` | yes | Rows across every page. |
| `onPage` | `(page: number) => void` | yes |  |

## Usage

```jsx
<Pager page={2} pageCount={12} total={573} onPage={() => {}} />
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.pager`

> Source: `gas_shared/ui/data.js` → `pager()`.
