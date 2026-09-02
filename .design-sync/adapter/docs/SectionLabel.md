---
category: Sheet
---

# SectionLabel

A section heading that can carry its own definition, so a term is defined where it is read rather than in a paragraph underneath.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `text` | `string` | yes |  |
| `help` | `Help` | — |  |

## Usage

```jsx
<SectionLabel text="Remediation coverage" help="The share of findings closed within their SLA window." />
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.section-label`

> Source: `gas_devsecops/src/client/js/ui/sheet.js` → `sectionLabel()`.
