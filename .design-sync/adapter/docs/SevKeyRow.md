---
category: Severity
---

# SevKeyRow

The key that reads a SevSegmentBar: each level, its dot and its count.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `counts` | `Partial<Record<Severity, number>>` | yes |  |
| `order` | `Severity[]` | — |  |

## Usage

```jsx
<SevKeyRow counts={{ CRITICAL: 24, HIGH: 96, MEDIUM: 210, LOW: 62 }} />
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.sevkey-row`
- `.sevkey-row--<variant>`
- `.sev-dot`
- `.sevkey-num`
- `.num`
- `.sevkey`
- `.sev-<variant>`

> Source: `gas_shared/ui/severity.js` → `sevKeyRow()`.
