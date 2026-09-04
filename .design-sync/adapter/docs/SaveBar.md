---
category: Settings
---

# SaveBar

The unsaved-changes bar: what changed, a jump to each changed field, discard and save. Sticky to the bottom of its container. It is HIDDEN until `changes` is non-empty — a bar offering to save nothing is worse than no bar.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `changes` | `Array<{ label: string; tab: string; tabLabel: string }>` | yes | What is unsaved. An empty list hides the bar. |
| `countText` | `string` | — | The lead, e.g. "3 unsaved changes". |
| `onSave` | `() => void` | yes |  |
| `onDiscard` | `() => void` | yes |  |
| `onJump` | `(tab: string) => void` | — | Jump to a changed field, by tab id. |
| `saveLabel` | `string` | — | Default "Save changes". |

## Usage

```jsx
<SaveBar
  countText="3 unsaved changes"
  changes={[
    { label: "Critical SLA", tab: "sla", tabLabel: "SLA" },
    { label: "High SLA", tab: "sla", tabLabel: "SLA" },
    { label: "Right-censoring", tab: "metrics", tabLabel: "Metrics" },
  ]}
  onSave={() => {}}
  onDiscard={() => {}}
  onJump={() => {}}
/>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.savebar__what`
- `.primary`
- `.savebar`
- `.savebar__spacer`
- `.link`
- `.savebar__tab`

> Source: `gas_shared/ui/settings.js` → `saveBar()`.
