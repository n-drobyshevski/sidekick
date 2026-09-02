---
category: Settings
---

# SwitchToggle

A two-state switch. Pair it with a SettingRow whose htmlFor matches this id.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `checked` | `boolean` | — | Default false. |
| `id` | `string` | — |  |
| `ariaLabel` | `string` | — |  |
| `disabled` | `boolean` | — |  |
| `onChange` | `(checked: boolean) => void` | — |  |

## Usage

```jsx
<div style={{ display: "flex", gap: 16, alignItems: "center" }}>
  <SwitchToggle id="sw-on" checked ariaLabel="On" onChange={() => {}} />
  <SwitchToggle id="sw-off" ariaLabel="Off" onChange={() => {}} />
  <SwitchToggle id="sw-dis" checked disabled ariaLabel="Disabled" onChange={() => {}} />
</div>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.switch__input`
- `.switch`
- `.switch__track`
- `.switch__thumb`

> Source: `gas_devsecops/src/client/js/ui/settings.js` → `switchToggle()`.
