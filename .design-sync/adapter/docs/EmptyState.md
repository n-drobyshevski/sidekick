---
category: Feedback
---

# EmptyState

Nothing to show, and why - distinct from ErrorState, which is a failure.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `message` | `string` | yes |  |
| `hint` | `string` | — | What the reader could do about it. |

## Usage

```jsx
<EmptyState
  message="No secrets findings in this scope."
  hint="Severity defaults to MEDIUM and above here — PASSWORD and CERTIFICATE both sit below HIGH."
/>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.empty`
- `.empty--`
- `.small`
- `.empty-items`
- `.empty-item`
- `.empty-item-figure`
- `.empty-item-unlock`
- `.linklike`
- `.empty-item-action`
- `.muted`

> Source: `gas_shared/ui/feedback.js` → `emptyState()`.
