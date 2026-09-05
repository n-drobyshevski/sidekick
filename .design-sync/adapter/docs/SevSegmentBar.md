---
category: Severity
---

# SevSegmentBar

A severity distribution drawn as one bar: a segment per level, grown by its count. Levels with nothing in them are not segments.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `counts` | `Partial<Record<Severity, number>>` | yes | A tally. Empty levels are dropped. |
| `order` | `Severity[]` | — | Segment order. Defaults to CRITICAL..UNKNOWN. |
| `size` | `"sm" \| "md" \| "lg"` | — | Default "md". |
| `label` | `string` | — | The accessible name. Omit for a bar whose numbers are already written beside it - it then goes aria-hidden rather than announcing the same figures twice. |
| `width` | `string` | — | Inline width, for a bar whose LENGTH carries the total. |
| `emptyHatch` | `boolean` | — | Draw a hatched full-width segment when there is nothing to show. |

## Usage

```jsx
<SevSegmentBar
  counts={{ CRITICAL: 24, HIGH: 96, MEDIUM: 210, LOW: 62 }}
  label="Open findings by severity"
/>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.sevbar`
- `.sevbar--<variant>`
- `.sevbar-seg`
- `.sev-fill-<variant>`
- `.sevbar-seg--empty`

> Source: `gas_shared/ui/severity.js` → `sevSegmentBar()`.
