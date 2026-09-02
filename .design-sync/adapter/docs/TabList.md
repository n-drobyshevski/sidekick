---
category: Settings
---

# TabList

A real ARIA tablist with roving tabindex and arrow-key cycling.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `tabs` | `Array<{ id: string; label: string }>` | yes |  |
| `active` | `string` | yes |  |
| `onSelect` | `(id: string) => void` | yes |  |
| `ariaLabel` | `string` | — |  |
| `idPrefix` | `string` | — | Default "tab". |

## Usage

```jsx
<TabList
  ariaLabel="Register"
  active="sast"
  onSelect={() => {}}
  tabs={[
    { id: "sast", label: "SAST" },
    { id: "sca", label: "SCA" },
    { id: "secrets", label: "Secrets" },
  ]}
/>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.tabstrip`
- `.tabstrip__dot`
- `.tabstrip__tab`
- `.tabstrip__label`

> Source: `gas_devsecops/src/client/js/ui/settings.js` → `tabList()`.
