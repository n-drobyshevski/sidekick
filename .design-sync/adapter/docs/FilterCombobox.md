---
category: Inputs
---

# FilterCombobox

A filtering combobox. editable:true swaps the trigger button for a real text input carrying role=combobox, per the ARIA editable-combobox pattern - DOM focus never leaves the input and the active row travels as aria-activedescendant. Three extras are opt-in and inert unless asked for, so a list that wants to be a plain list stays one.

## Props

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `value` | `string` | yes |  |
| `options` | `Array<string \| Option>` | yes |  |
| `onChange` | `(value: string) => void` | yes |  |
| `ariaLabel` | `string` | — |  |
| `searchPlaceholder` | `string` | — | Default "Search…". |
| `defaultLabel` | `string` | — |  |
| `fallbackLabel` | `string` | — | Shown for a value the list does not carry. |
| `searchThreshold` | `number` | — | Rows before a search box appears. Default 7. |
| `editable` | `boolean` | — | Real text input rather than a trigger button. |
| `allowCustom` | `boolean` | — | Synthesise a "use what you typed" row. Editable mode only. |
| `checkSelected` | `boolean` | — | Mark the chosen row with a glyph rather than colour and weight alone. |
| `header` | `{ title: string; note?: string } \| null` | — | A heading and a sentence above the search. |

## Usage

```jsx
<FilterCombobox
  ariaLabel="Repository"
  value="payments-api"
  onChange={() => {}}
  options={["payments-api", "ledger-svc", "report-gen", "auth-edge"]}
/>
```

## Class vocabulary

These are the classes this component emits, taken from its factory source. They are part of the design system: styling around this component, or hand-writing the same structure, uses these names rather than new ones.

- `.combobox-input`
- `.combobox-caret-btn`
- `.combobox-edit`
- `.combobox-trigger-text`
- `.combobox-trigger`
- `.combobox-caret`
- `.combobox`
- `.combobox-option`
- `.combobox-option-icon`
- `.combobox-option-hint`
- `.combobox-check`
- `.combobox-group`
- `.combobox-empty`
- `.combobox-head`
- `.combobox-head-title`
- `.combobox-head-note`
- `.combobox-list`
- `.combobox-search`
- `.combobox-search-wrap`
- `.combobox-search-icon`

> Source: `gas_devsecops/src/client/js/ui/combobox.js` → `filterCombobox()`.
