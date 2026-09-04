---
category: Controls
---

# StatusPill

OK / warn / bad / neutral state, with a dot the colour never carries alone.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `kind` | `"ok" \| "warn" \| "bad" \| "neutral"` | yes | Which state token dresses the pill. |
| `text` | `string` | yes | One or two words naming the state. |
| `help` | `Help` | — | What the state actually means - a pill rarely tells the whole story. |

## Usage

```jsx
<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
  <StatusPill kind="ok" text="Within SLA" />
  <StatusPill kind="warn" text="Due in 3d" />
  <StatusPill kind="bad" text="Overdue" />
  <StatusPill kind="neutral" text="Not assessed" />
</div>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.pill`

> Source: `gas_shared/ui/controls.js` → `statusPill()`.
