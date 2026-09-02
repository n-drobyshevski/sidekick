---
category: Feedback
---

# ErrorState

Failure, not emptiness: announced via role=alert, retryable in place, and the raw exception demoted into a disclosure instead of printed at the reader as body copy.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `message` | `string` | yes |  |
| `onRetry` | `() => void` | — | Draws a "Try again" button. |
| `detail` | `string` | — | The raw exception, folded into a "Technical details" disclosure. |

## Usage

```jsx
<ErrorState
  message="Could not reach the Wiz API."
  onRetry={() => {}}
  detail="HTTP 400 VALIDATION_INVALID_TYPE_VARIABLE: SASTFindingFilters.severity expects SASTSeverityFilter"
/>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.empty`
- `.empty--error`
- `.empty-actions`
- `.primary`
- `.empty-detail`
- `.small`

> Source: `gas_devsecops/src/client/js/ui/feedback.js` → `errorState()`.
