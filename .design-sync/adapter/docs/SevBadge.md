---
category: Severity
---

# SevBadge

One severity level as a badge: a dot plus the level in words. role=img, not role=status - a detail sheet paints a dozen of these, and a dozen live regions is an announcement storm.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `severity` | `Severity` | yes |  |

## Usage

```jsx
<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
  <SevBadge severity="CRITICAL" />
  <SevBadge severity="HIGH" />
  <SevBadge severity="MEDIUM" />
  <SevBadge severity="LOW" />
  <SevBadge severity="INFO" />
</div>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.sev-badge`
- `.sev-<variant>`
- `.sev-dot`

> Source: `gas_devsecops/src/client/js/ui/severity.js` → `sevBadge()`.
