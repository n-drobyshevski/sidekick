---
category: Sheet
---

# SheetRow

One row of a record sheet's issue / finding / relationship list. Becomes a button when onOpen is given, so a row that leads somewhere is reachable by keyboard.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `title` | `string` | — |  |
| `note` | `string` | — |  |
| `fix` | `string` | — | Rendered as a "Recommended fix" block. |
| `badge` | `React.ReactNode` | — | Normally a SevBadge. |
| `onOpen` | `() => void` | — | Makes the whole row a button. |
| `ariaLabel` | `string` | — |  |
| `extraClass` | `string` | — |  |

## Usage

```jsx
<SheetRow
  title="Hardcoded credential in config/database.yml"
  note="payments-api · first seen 41 days ago"
  fix="Move the value to a secret manager and rotate the credential — removal from HEAD is not rotation."
  badge={<SevBadge severity="CRITICAL" />}
/>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.sheet-row-head`
- `.sheet-row-title`
- `.sheet-row-note`
- `.sheet-fix`
- `.sheet-fix-label`
- `.sheet-fix-body`
- `.sheet-row--static`

> Source: `gas_devsecops/src/client/js/ui/sheet.js` → `sheetRow()`.
