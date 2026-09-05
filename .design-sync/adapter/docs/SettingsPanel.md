---
category: Settings
---

# SettingsPanel

A titled panel grouping related settings, with an optional footer for its actions.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `title` | `string` | — |  |
| `description` | `string` | — |  |
| `children` | `React.ReactNode` | — | The panel body - normally a stack of SettingRow. |
| `footer` | `React.ReactNode` | — |  |

## Usage

```jsx
<SettingsPanel
  title="Remediation SLA"
  description="How long each severity may stay open before the register calls it overdue."
  footer={
    <SaveBar
      countText="2 unsaved changes"
      changes={[
        { label: "Critical", tab: "sla", tabLabel: "SLA" },
        { label: "High", tab: "sla", tabLabel: "SLA" },
      ]}
      onSave={() => {}}
      onDiscard={() => {}}
    />
  }
>
  <SettingRow label="Critical" description="Days before a critical finding is overdue." htmlFor="sla-crit">
    <SwitchToggle id="sla-crit" checked onChange={() => {}} />
  </SettingRow>
  <SettingRow label="High" description="Days before a high finding is overdue." htmlFor="sla-high">
    <SwitchToggle id="sla-high" onChange={() => {}} />
  </SettingRow>
</SettingsPanel>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.settings-panel__head`
- `.settings-panel__title`
- `.settings-panel__desc`
- `.muted`
- `.small`
- `.settings-panel__body`
- `.settings-panel`
- `.settings-panel__foot`

> Source: `gas_shared/ui/settings.js` → `settingsPanel()`.
