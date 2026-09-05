---
category: Settings
---

# SettingRow

One setting: its name, a sentence saying what it does, and the control that changes it.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `label` | `string` | yes |  |
| `description` | `string` | — |  |
| `children` | `React.ReactNode` | yes | The control - normally a SwitchToggle. |
| `htmlFor` | `string` | — | The control id, so the label associates with it. |

## Usage

```jsx
<SettingRow
  label="Count open findings as right-censored"
  description="Keeps unresolved findings in the MTTR curve instead of dropping them."
  htmlFor="censor"
>
  <SwitchToggle id="censor" checked onChange={() => {}} />
</SettingRow>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.setting-row__title`
- `.setting-row`
- `.setting-row__label`
- `.setting-row__desc`
- `.muted`
- `.small`
- `.setting-row__control`

> Source: `gas_shared/ui/settings.js` → `settingRow()`.
