---
category: Sheet
---

# SheetSection

One titled section of a record sheet.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `label` | `string` | — |  |
| `children` | `React.ReactNode` | yes |  |

## Usage

```jsx
<SheetSection label="Findings">
  <SheetRow
    title="Hardcoded credential in config/database.yml"
    note="payments-api · line 42"
    badge={<SevBadge severity="CRITICAL" />}
  />
</SheetSection>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.sheet-section`
- `.label`
- `.sheet-section-title`

> Source: `gas_shared/ui/sheet.js` → `sheetSection()`.
