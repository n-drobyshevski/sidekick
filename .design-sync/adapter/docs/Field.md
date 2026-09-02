---
category: Controls
---

# Field

A labelled field. The visible label IS the accessible name (a real label-for), and the hint rides along as aria-describedby - so voice control can address the field by the words next to it. Give your control the same id you pass here.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | `string` | yes | Must match the id on the control you pass as children. |
| `label` | `string` | yes |  |
| `children` | `React.ReactNode` | yes | The input. Set its id to `id` so the label associates. |
| `hint` | `string` | — |  |

## Usage

```jsx
<Field id="sla-window" label="SLA window" hint="Days allowed before a critical finding is overdue.">
  <input id="sla-window" type="number" defaultValue={30} />
</Field>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.field-label`
- `.field-error`
- `.field`
- `.field-hint`
- `.small`
- `.muted`

> Source: `gas_devsecops/src/client/js/ui/controls.js` → `field()`.
