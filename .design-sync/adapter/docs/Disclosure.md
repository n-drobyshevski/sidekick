---
category: Settings
---

# Disclosure

A native details/summary fold, for detail that should be available without being in the way.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `summary` | `string` | yes |  |
| `children` | `React.ReactNode` | yes |  |

## Usage

```jsx
<Disclosure summary="Why this finding has no resolved date">
  <p className="small muted">
    SASTFinding exposes createdAt but no resolvedAt, and status: RESOLVED returns 0 rows.
    The ledger dates the death by disappearance instead.
  </p>
</Disclosure>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.why`
- `.why__caret`
- `.why__body`

> Source: `gas_devsecops/src/client/js/ui/settings.js` → `disclosure()`.
