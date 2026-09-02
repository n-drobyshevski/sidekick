---
category: Cells
---

# TriCell

A tri-state cell: true, false, or absent. Wiz returns null for a flag it never evaluated, and collapsing that to false is what makes an unassessed asset render as clean.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `value` | `boolean \| null` | yes |  |

## Usage

```jsx
<div style={{ display: "flex", gap: 16 }}>
  <TriCell value={true} />
  <TriCell value={false} />
  <TriCell value={null} />
</div>
```

> Source: `gas_devsecops/src/client/js/ui/cells.js` → `triCell()`.
