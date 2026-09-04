---
category: Data
---

# TableFooter

The pager plus a rows-per-page select. onPageSize receives the page already recomputed for the new size.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `page` | `number` | yes | Zero-based. |
| `pageCount` | `number` | yes |  |
| `total` | `number` | yes |  |
| `pageSize` | `number` | yes |  |
| `sizes` | `number[]` | — | Defaults to PAGE_SIZES (25/50/100/250). |
| `onPage` | `(page: number) => void` | — |  |
| `onPageSize` | `(size: number, page: number) => void` | — |  |

## Usage

```jsx
<div style={{ width: 520 }}>
  <TableFooter page={2} pageCount={12} total={573} pageSize={50} onPage={() => {}} onPageSize={() => {}} />
</div>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.table-footer`

> Source: `gas_shared/ui/data.js` → `tableFooter()`.
