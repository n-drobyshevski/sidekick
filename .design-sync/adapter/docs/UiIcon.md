---
category: Brand
---

# UiIcon

One stroked interface icon from the set.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | `UiIconName` | yes |  |
| `size` | `number` | — | Default 16. |

## Usage

```jsx
<div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 20, width: 420 }}>
  {["search", "filter", "table", "graph", "check", "external", "close", "chevron-down",
    "plus", "minus", "eye", "eye-off", "link", "braces", "folder", "tag", "doc", "pencil"].map((n) => (
    <div key={n} style={{ display: "grid", justifyItems: "center", gap: 6 }}>
      <UiIcon name={n} size={24} />
      <span style={{ fontSize: 9, color: "var(--text-2)" }}>{n}</span>
    </div>
  ))}
</div>
```

> Source: `gas_shared/ui/uiIcons.js` → `uiIcon()`.
